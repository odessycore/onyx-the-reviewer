import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { hostname } from 'node:os';
import { fullJitterDelayMs } from '../common/backoff';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobHandlerRegistry } from './job-handler';

interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

@Injectable()
export class JobWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobWorker.name);
  private readonly workerId = `${hostname()}#${process.pid}`;
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.worker.enabled) {
      this.logger.warn('Job worker is disabled (WORKER_ENABLED=false)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.config.worker.pollIntervalMs);
    this.logger.log(`Job worker started as ${this.workerId}`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      await this.reclaimStuckJobs();
      const jobs = await this.claimBatch(this.config.worker.batchSize);
      await Promise.allSettled(jobs.map((job) => this.process(job)));
    } catch (error) {
      this.logger.error(`Worker tick failed: ${this.describe(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  // Recovers jobs whose worker died mid-run: a row stuck in 'running' past the timeout is
  // returned to the queue (or dead-lettered if it has already exhausted its attempts).
  private async reclaimStuckJobs(): Promise<void> {
    const seconds = Math.ceil(this.config.worker.stuckTimeoutMs / 1000);
    const reclaimed = await this.prisma.$executeRaw`
      UPDATE "Job"
      SET status = CASE WHEN attempts >= "maxAttempts" THEN 'failed' ELSE 'pending' END,
          "lockedAt" = null,
          "lockedBy" = null,
          "lastError" = 'Reclaimed after worker stall',
          "updatedAt" = now()
      WHERE status = 'running' AND "lockedAt" < now() - make_interval(secs => ${seconds});
    `;
    if (reclaimed > 0) {
      this.logger.warn(`Reclaimed ${reclaimed} stuck job(s)`);
    }
  }

  // Atomically claims due jobs. SKIP LOCKED lets multiple workers/instances pull from the
  // same queue without blocking each other; `attempts` is incremented on claim.
  private claimBatch(batchSize: number): Promise<ClaimedJob[]> {
    return this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "Job" AS j
      SET status = 'running',
          "lockedAt" = now(),
          "lockedBy" = ${this.workerId},
          attempts = j.attempts + 1,
          "updatedAt" = now()
      WHERE j.id IN (
        SELECT id FROM "Job"
        WHERE status = 'pending' AND "runAt" <= now()
        ORDER BY "runAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      RETURNING j.id, j.type, j.payload, j.attempts, j."maxAttempts";
    `;
  }

  private async process(job: ClaimedJob): Promise<void> {
    const handler = this.registry.get(job.type);
    if (!handler) {
      await this.deadLetter(job, `No handler registered for job type "${job.type}"`);
      return;
    }

    try {
      await handler.handle(job.payload, { jobId: job.id, attempt: job.attempts });
      await this.complete(job.id);
    } catch (error) {
      await this.onFailure(job, error);
    }
  }

  private async onFailure(job: ClaimedJob, error: unknown): Promise<void> {
    const message = this.describe(error);
    if (job.attempts >= job.maxAttempts) {
      this.logger.error(`Job ${job.id} (${job.type}) permanently failed: ${message}`);
      await this.deadLetter(job, message);
      return;
    }

    const delayMs = fullJitterDelayMs(job.attempts, {
      baseMs: this.config.worker.backoffBaseMs,
      capMs: this.config.worker.backoffCapMs,
    });
    this.logger.warn(
      `Job ${job.id} (${job.type}) failed attempt ${job.attempts}/${job.maxAttempts}, ` +
        `retrying in ${delayMs}ms: ${message}`,
    );
    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        status: 'pending',
        runAt: new Date(Date.now() + delayMs),
        lastError: message,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  private complete(id: string): Promise<unknown> {
    return this.prisma.job.update({
      where: { id },
      data: { status: 'completed', lockedAt: null, lockedBy: null, lastError: null },
    });
  }

  private async deadLetter(job: ClaimedJob, message: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: job.id },
      data: { status: 'failed', lastError: message, lockedAt: null, lockedBy: null },
    });
    try {
      await this.registry.get(job.type)?.onDeadLetter?.(job.payload, message);
    } catch (error) {
      this.logger.error(`onDeadLetter for job ${job.id} failed: ${this.describe(error)}`);
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.stack ?? error.message : String(error);
  }
}
