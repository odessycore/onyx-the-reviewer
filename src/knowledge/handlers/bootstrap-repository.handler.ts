import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { JobType } from '../../jobs/job-type';
import { PrismaService } from '../../prisma/prisma.service';
import { RepoIndexerService } from '../repo-indexer.service';

interface BootstrapPayload {
  repositoryId: string;
  installationGithubId: number;
}

@Injectable()
export class BootstrapRepositoryHandler implements JobHandler<BootstrapPayload>, OnModuleInit {
  readonly type = JobType.BootstrapRepository;

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: RepoIndexerService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: BootstrapPayload): Promise<void> {
    const repository = await this.prisma.repository.findUnique({
      where: { id: payload.repositoryId },
    });
    if (!repository) {
      return;
    }
    await this.indexer.indexRepository(repository, payload.installationGithubId);
  }
}
