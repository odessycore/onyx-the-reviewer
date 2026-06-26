import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';

export interface EnqueueOptions {
  idempotencyKey?: string;
  maxAttempts?: number;
  runAt?: Date;
}

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class JobQueueService {
  private readonly logger = new Logger(JobQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  // Enqueues a job. When an idempotencyKey is supplied a duplicate enqueue is a no-op,
  // so a redelivered webhook (or a retried producer) never creates a second job.
  async enqueue(
    type: string,
    payload: Prisma.InputJsonValue,
    options: EnqueueOptions = {},
  ): Promise<{ enqueued: boolean }> {
    try {
      await this.prisma.job.create({
        data: {
          type,
          payload,
          idempotencyKey: options.idempotencyKey,
          maxAttempts: options.maxAttempts ?? this.config.worker.maxAttempts,
          runAt: options.runAt ?? new Date(),
        },
      });
      return { enqueued: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
        this.logger.debug(`Skipping duplicate job ${type} (${options.idempotencyKey})`);
        return { enqueued: false };
      }
      throw error;
    }
  }
}
