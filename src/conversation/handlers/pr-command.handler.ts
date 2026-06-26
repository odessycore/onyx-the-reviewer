import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { JobType } from '../../jobs/job-type';
import { ConversationOrchestratorService } from '../conversation-orchestrator.service';
import { PrCommandPayload } from '../conversation.types';

@Injectable()
export class PrCommandHandler implements JobHandler<PrCommandPayload>, OnModuleInit {
  readonly type = JobType.PrCommand;

  constructor(
    private readonly orchestrator: ConversationOrchestratorService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  handle(payload: PrCommandPayload): Promise<void> {
    return this.orchestrator.handle(payload);
  }
}
