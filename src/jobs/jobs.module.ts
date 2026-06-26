import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { JobHandlerRegistry } from './job-handler';
import { JobQueueService } from './job-queue.service';
import { JobWorker } from './job.worker';

@Global()
@Module({
  providers: [JobQueueService, JobHandlerRegistry, IdempotencyService, JobWorker],
  exports: [JobQueueService, JobHandlerRegistry, IdempotencyService],
})
export class JobsModule {}
