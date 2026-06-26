import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ReviewPullRequestHandler } from './handlers/review-pull-request.handler';
import { PrIntentService } from './pr-intent.service';
import { ReviewOrchestratorService } from './review-orchestrator.service';
import { ReviewPromptBuilder } from './review-prompt.builder';
import { ReviewResultMapper } from './review-result.mapper';

@Module({
  imports: [KnowledgeModule],
  providers: [
    PrIntentService,
    ReviewPromptBuilder,
    ReviewResultMapper,
    ReviewOrchestratorService,
    ReviewPullRequestHandler,
  ],
  exports: [ReviewOrchestratorService],
})
export class ReviewModule {}
