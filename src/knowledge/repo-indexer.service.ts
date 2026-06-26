import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Repository } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { GithubApiService } from '../github/github-api.service';
import { InstallationsService } from '../installations/installations.service';
import { PrismaService } from '../prisma/prisma.service';
import { chunkFile, isIndexablePath, MAX_INDEXABLE_FILE_BYTES } from './chunking';
import { EmbeddingService } from './embedding/embedding.service';
import { RepoProfileService } from './repo-profile.service';

const MAX_FILES = 800;
const MAX_CHUNKS = 6000;
const INSERT_BATCH = 300;

interface IndexedChunk {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  blobSha: string;
}

@Injectable()
export class RepoIndexerService {
  private readonly logger = new Logger(RepoIndexerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly installations: InstallationsService,
    private readonly github: GithubApiService,
    private readonly embeddings: EmbeddingService,
    private readonly profiles: RepoProfileService,
  ) {}

  async indexRepository(repository: Repository, installationGithubId: number): Promise<void> {
    const installation = await this.installations.getInstallation(repository.installationId);
    if (!installation) {
      throw new Error(`Installation ${repository.installationId} not found`);
    }
    const embeddingConfig = this.installations.resolveEmbeddingConfig(installation);

    await this.prisma.repository.update({
      where: { id: repository.id },
      data: { indexStatus: 'indexing' },
    });

    try {
      const { owner, name } = repository;
      const repoInfo = await this.github.getRepository(installationGithubId, owner, name);
      const headSha = await this.github.getBranchHeadSha(
        installationGithubId, owner, name, repoInfo.defaultBranch,
      );
      const tree = await this.github.getTree(installationGithubId, owner, name, headSha);

      const profile = await this.profiles.buildProfile(
        installationGithubId, owner, name, repoInfo.defaultBranch, headSha, tree,
      );

      const chunks = await this.collectChunks(installationGithubId, owner, name, headSha, tree);
      const vectors = await this.embeddings.embedBatch(
        chunks.map((chunk) => chunk.content),
        embeddingConfig,
      );

      await this.replaceChunks(repository.id, chunks, vectors);

      await this.prisma.repository.update({
        where: { id: repository.id },
        data: {
          indexStatus: 'ready',
          indexedSha: headSha,
          indexedAt: new Date(),
          defaultBranch: repoInfo.defaultBranch,
          profile: profile as unknown as Prisma.InputJsonValue,
        },
      });
      this.logger.log(`Indexed ${repository.fullName}: ${chunks.length} chunks at ${headSha}`);
    } catch (error) {
      await this.prisma.repository.update({
        where: { id: repository.id },
        data: { indexStatus: 'failed' },
      });
      throw error;
    }
  }

  private async collectChunks(
    installationGithubId: number,
    owner: string,
    repo: string,
    ref: string,
    tree: { path: string; type: string; sha: string; size?: number }[],
  ): Promise<IndexedChunk[]> {
    const blobs = tree
      .filter((entry) => entry.type === 'blob' && isIndexablePath(entry.path))
      .filter((entry) => (entry.size ?? 0) <= MAX_INDEXABLE_FILE_BYTES)
      .slice(0, MAX_FILES);

    const chunks: IndexedChunk[] = [];
    for (const blob of blobs) {
      if (chunks.length >= MAX_CHUNKS) {
        this.logger.warn(`Reached ${MAX_CHUNKS} chunk cap for ${owner}/${repo}; truncating index`);
        break;
      }
      const content = await this.github.getFileContent(installationGithubId, owner, repo, blob.path, ref);
      if (!content) {
        continue;
      }
      for (const chunk of chunkFile(blob.path, content)) {
        chunks.push({ ...chunk, blobSha: blob.sha });
      }
    }
    return chunks.slice(0, MAX_CHUNKS);
  }

  private async replaceChunks(
    repositoryId: string,
    chunks: IndexedChunk[],
    vectors: number[][],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.codeChunk.deleteMany({ where: { repositoryId } });
      for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
        const batch = chunks.slice(i, i + INSERT_BATCH);
        const rows = batch.map((chunk, j) => {
          const literal = `[${vectors[i + j].join(',')}]`;
          return Prisma.sql`(${randomUUID()}, ${repositoryId}, ${chunk.filePath}, ${chunk.startLine}, ${chunk.endLine}, ${chunk.content}, ${chunk.blobSha}, ${literal}::vector)`;
        });
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "CodeChunk" ("id", "repositoryId", "filePath", "startLine", "endLine", "content", "blobSha", "embedding") VALUES ${Prisma.join(rows)}`,
        );
      }
    });
  }
}
