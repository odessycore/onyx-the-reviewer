import { Injectable, Logger } from '@nestjs/common';

export interface JobContext {
  jobId: string;
  attempt: number;
}

export interface JobHandler<TPayload = unknown> {
  readonly type: string;
  handle(payload: TPayload, context: JobContext): Promise<void>;
  // Called once when a job is permanently failed (dead-lettered), so a handler can notify
  // the user. Best-effort: errors thrown here are swallowed by the worker.
  onDeadLetter?(payload: TPayload, error: string): Promise<void>;
}

// Handlers self-register here on module init, keeping the worker decoupled from the
// feature modules that own each job type (avoids circular dependencies).
@Injectable()
export class JobHandlerRegistry {
  private readonly logger = new Logger(JobHandlerRegistry.name);
  private readonly handlers = new Map<string, JobHandler>();

  register(handler: JobHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`Duplicate job handler registered for type "${handler.type}"`);
    }
    this.handlers.set(handler.type, handler);
    this.logger.log(`Registered handler for job type "${handler.type}"`);
  }

  get(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }
}
