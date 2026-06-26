import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobHandler, JobHandlerRegistry } from '../../jobs/job-handler';
import { JobType } from '../../jobs/job-type';
import { PrismaService } from '../../prisma/prisma.service';
import { RepoIndexerService } from '../repo-indexer.service';

interface RefreshPayload {
  repositoryId: string;
  installationGithubId: number;
  sha: string;
}

@Injectable()
export class RefreshIndexHandler implements JobHandler<RefreshPayload>, OnModuleInit {
  readonly type = JobType.RefreshIndex;

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: RepoIndexerService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(payload: RefreshPayload): Promise<void> {
    const repository = await this.prisma.repository.findUnique({
      where: { id: payload.repositoryId },
    });
    if (!repository || repository.indexedSha === payload.sha) {
      return;
    }
    await this.indexer.indexRepository(repository, payload.installationGithubId);
  }
}
