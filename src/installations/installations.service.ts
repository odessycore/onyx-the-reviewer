import { Injectable } from '@nestjs/common';
import { Installation, Repository } from '@prisma/client';
import { EncryptionService } from '../common/encryption.service';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResolvedEmbeddingConfig, ResolvedLlmConfig } from './installation-settings';

export interface RepositoryIdentity {
  githubRepoId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch?: string;
  isPrivate?: boolean;
}

export interface InstallationSettingsUpdate {
  llmProvider?: string;
  llmModel?: string;
  llmApiKey?: string | null;
  embeddingBaseUrl?: string;
  embeddingModel?: string;
  embeddingApiKey?: string | null;
  enabled?: boolean;
}

@Injectable()
export class InstallationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  ensureInstallation(
    githubInstallationId: number,
    accountLogin: string,
    accountType: string,
  ): Promise<Installation> {
    return this.prisma.installation.upsert({
      where: { githubInstallationId: BigInt(githubInstallationId) },
      create: { githubInstallationId: BigInt(githubInstallationId), accountLogin, accountType },
      update: { accountLogin, accountType, suspendedAt: null },
    });
  }

  setSuspended(githubInstallationId: number, suspended: boolean): Promise<unknown> {
    return this.prisma.installation.updateMany({
      where: { githubInstallationId: BigInt(githubInstallationId) },
      data: { suspendedAt: suspended ? new Date() : null },
    });
  }

  ensureRepository(installationId: string, identity: RepositoryIdentity): Promise<Repository> {
    return this.prisma.repository.upsert({
      where: { githubRepoId: BigInt(identity.githubRepoId) },
      create: {
        installationId,
        githubRepoId: BigInt(identity.githubRepoId),
        owner: identity.owner,
        name: identity.name,
        fullName: identity.fullName,
        defaultBranch: identity.defaultBranch ?? 'main',
        isPrivate: identity.isPrivate ?? true,
      },
      update: {
        installationId,
        owner: identity.owner,
        name: identity.name,
        fullName: identity.fullName,
        ...(identity.defaultBranch ? { defaultBranch: identity.defaultBranch } : {}),
        ...(identity.isPrivate !== undefined ? { isPrivate: identity.isPrivate } : {}),
      },
    });
  }

  findRepositoryByGithubId(githubRepoId: number): Promise<Repository | null> {
    return this.prisma.repository.findUnique({ where: { githubRepoId: BigInt(githubRepoId) } });
  }

  // Removes a PR and everything hanging off it (reviews, conversation threads + messages)
  // via cascade. Used when a PR is closed/merged.
  async deletePullRequest(repositoryId: string, number: number): Promise<void> {
    await this.prisma.pullRequest.deleteMany({ where: { repositoryId, number } });
  }

  getInstallation(installationId: string): Promise<Installation | null> {
    return this.prisma.installation.findUnique({ where: { id: installationId } });
  }

  listInstallations(): Promise<
    Array<{
      id: string;
      accountLogin: string;
      llmProvider: string | null;
      llmModel: string | null;
      embeddingModel: string | null;
      enabled: boolean;
    }>
  > {
    return this.prisma.installation.findMany({
      select: {
        id: true,
        accountLogin: true,
        llmProvider: true,
        llmModel: true,
        embeddingModel: true,
        enabled: true,
      },
    });
  }

  updateSettings(githubInstallationId: number, settings: InstallationSettingsUpdate): Promise<Installation> {
    const data: Record<string, unknown> = {};
    if (settings.llmProvider !== undefined) data.llmProvider = settings.llmProvider;
    if (settings.llmModel !== undefined) data.llmModel = settings.llmModel;
    if (settings.llmApiKey !== undefined) {
      data.llmApiKeyEncrypted = settings.llmApiKey ? this.encryption.encrypt(settings.llmApiKey) : null;
    }
    if (settings.embeddingBaseUrl !== undefined) data.embeddingBaseUrl = settings.embeddingBaseUrl;
    if (settings.embeddingModel !== undefined) data.embeddingModel = settings.embeddingModel;
    if (settings.embeddingApiKey !== undefined) {
      data.embeddingApiKeyEncrypted = settings.embeddingApiKey
        ? this.encryption.encrypt(settings.embeddingApiKey)
        : null;
    }
    if (settings.enabled !== undefined) data.enabled = settings.enabled;

    return this.prisma.installation.update({
      where: { githubInstallationId: BigInt(githubInstallationId) },
      data,
    });
  }

  resolveLlmConfig(installation: Installation): ResolvedLlmConfig {
    return {
      provider: installation.llmProvider ?? this.config.llm.provider,
      baseUrl: this.config.llm.baseUrl,
      model: installation.llmModel ?? this.config.llm.model,
      apiKey: installation.llmApiKeyEncrypted
        ? this.encryption.decrypt(installation.llmApiKeyEncrypted)
        : this.config.llm.apiKey,
    };
  }

  resolveEmbeddingConfig(installation: Installation): ResolvedEmbeddingConfig {
    return {
      provider: this.config.embedding.provider,
      baseUrl: installation.embeddingBaseUrl ?? this.config.embedding.baseUrl,
      model: installation.embeddingModel ?? this.config.embedding.model,
      apiKey: installation.embeddingApiKeyEncrypted
        ? this.encryption.decrypt(installation.embeddingApiKeyEncrypted)
        : this.config.embedding.apiKey,
      dimensions: this.config.embedding.dimensions,
    };
  }
}
