import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ReviewModule } from '../review/review.module';
import { ConversationOrchestratorService } from './conversation-orchestrator.service';
import { ConversationPromptBuilder } from './conversation-prompt.builder';
import { ConversationService } from './conversation.service';
import { PrCommandHandler } from './handlers/pr-command.handler';

@Module({
  imports: [KnowledgeModule, ReviewModule],
  providers: [
    ConversationService,
    ConversationPromptBuilder,
    ConversationOrchestratorService,
    PrCommandHandler,
  ],
})
export class ConversationModule {}
