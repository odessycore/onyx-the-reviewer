import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { JobType } from '../../jobs/job-type';
import { ReviewOrchestratorService, ReviewPayload } from '../review-orchestrator.service';

@Injectable()
export class ReviewPullRequestHandler implements JobHandler<ReviewPayload>, OnModuleInit {
  readonly type = JobType.ReviewPullRequest;

  constructor(
    private readonly orchestrator: ReviewOrchestratorService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  handle(payload: ReviewPayload): Promise<void> {
    return this.orchestrator.review(payload);
  }

  onDeadLetter(payload: ReviewPayload, error: string): Promise<void> {
    return this.orchestrator.notifyReviewFailure(payload, error);
  }
}
