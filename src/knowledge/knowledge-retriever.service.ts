import { Injectable } from '@nestjs/common';
import { Installation, Repository } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { GithubApiService } from '../github/github-api.service';
import { InstallationsService } from '../installations/installations.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding/embedding.service';
import {
  ChangedFileContent,
  ChangedFileRef,
  KnowledgeContext,
  RetrievedChunk,
} from './knowledge.types';
import { RepoProfile } from './repo-profile.types';

const TOP_K = 12;
const MAX_LAZY_FILES = 25;
const MAX_FILE_CHARS = 16_000;
const MAX_QUERY_CHARS = 8_000;

@Injectable()
export class KnowledgeRetrieverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly installations: InstallationsService,
    private readonly embeddings: EmbeddingService,
    private readonly github: GithubApiService,
  ) {}

  async retrieve(
    repository: Repository,
    installation: Installation,
    installationGithubId: number,
    changedFiles: ChangedFileRef[],
    headSha: string,
  ): Promise<KnowledgeContext> {
    const profile = (repository.profile as unknown as RepoProfile) ?? null;
    const relevantChunks = await this.searchRelevantChunks(
      repository,
      installation,
      changedFiles,
    );
    const changedFileContents = await this.fetchChangedFiles(
      installationGithubId,
      repository,
      changedFiles,
      headSha,
    );
    return { profile, relevantChunks, changedFileContents };
  }

  private async searchRelevantChunks(
    repository: Repository,
    installation: Installation,
    changedFiles: ChangedFileRef[],
  ): Promise<RetrievedChunk[]> {
    if (repository.indexStatus !== 'ready') {
      return [];
    }
    const queryText = changedFiles
      .map((file) => `${file.filename}\n${file.patch ?? ''}`)
      .join('\n')
      .slice(0, MAX_QUERY_CHARS);
    if (queryText.trim().length === 0) {
      return [];
    }

    const embeddingConfig = this.installations.resolveEmbeddingConfig(installation);
    const queryVector = await this.embeddings.embedOne(queryText, embeddingConfig);
    const literal = `[${queryVector.join(',')}]`;

    return this.prisma.$queryRaw<RetrievedChunk[]>(Prisma.sql`
      SELECT "filePath", "startLine", "endLine", "content",
             1 - ("embedding" <=> ${literal}::vector) AS "score"
      FROM "CodeChunk"
      WHERE "repositoryId" = ${repository.id} AND "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${literal}::vector
      LIMIT ${TOP_K}
    `);
  }

  private async fetchChangedFiles(
    installationGithubId: number,
    repository: Repository,
    changedFiles: ChangedFileRef[],
    headSha: string,
  ): Promise<ChangedFileContent[]> {
    const targets = changedFiles
      .filter((file) => file.status !== 'removed')
      .slice(0, MAX_LAZY_FILES);

    const contents: ChangedFileContent[] = [];
    for (const file of targets) {
      const content = await this.github.getFileContent(
        installationGithubId,
        repository.owner,
        repository.name,
        file.filename,
        headSha,
      );
      if (content) {
        contents.push({ path: file.filename, content: content.slice(0, MAX_FILE_CHARS) });
      }
    }
    return contents;
  }
}
