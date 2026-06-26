import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
import { ConfigModule } from './config/config.module';
import { ConversationModule } from './conversation/conversation.module';
import { GithubModule } from './github/github.module';
import { HealthModule } from './health/health.module';
import { InstallationsModule } from './installations/installations.module';
import { JobsModule } from './jobs/jobs.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { LlmModule } from './llm/llm.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReviewModule } from './review/review.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    PrismaModule,
    CommonModule,
    JobsModule,
    InstallationsModule,
    GithubModule,
    LlmModule,
    KnowledgeModule,
    ReviewModule,
    ConversationModule,
    HealthModule,
  ],
})
export class AppModule {}
