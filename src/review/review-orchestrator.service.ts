import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GithubApiService } from '../github/github-api.service';
import { ChangedFileRef } from '../knowledge/knowledge.types';
import { KnowledgeRetrieverService } from '../knowledge/knowledge-retriever.service';
import { InstallationsService } from '../installations/installations.service';
import { IdempotencyService } from '../jobs/idempotency.service';
import { JobQueueService } from '../jobs/job-queue.service';
import { JobType } from '../jobs/job-type';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { PrIntentService } from './pr-intent.service';
import { ReviewPromptBuilder } from './review-prompt.builder';
import { ReviewResultMapper } from './review-result.mapper';
import { ReviewLlmOutput } from './review.types';

export interface ReviewPayload {
  repositoryId: string;
  installationGithubId: number;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
}

@Injectable()
export class ReviewOrchestratorService {
  private readonly logger = new Logger(ReviewOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly installations: InstallationsService,
    private readonly github: GithubApiService,
    private readonly intent: PrIntentService,
    private readonly knowledge: KnowledgeRetrieverService,
    private readonly promptBuilder: ReviewPromptBuilder,
    private readonly mapper: ReviewResultMapper,
    private readonly llm: LlmService,
    private readonly queue: JobQueueService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async review(payload: ReviewPayload): Promise<void> {
    const repository = await this.prisma.repository.findUnique({
      where: { id: payload.repositoryId },
    });
    if (!repository || !repository.enabled) {
      return;
    }
    const installation = await this.installations.getInstallation(repository.installationId);
    if (!installation || !installation.enabled || installation.suspendedAt) {
      return;
    }

    await this.ensureIndexed(repository.id, repository.indexStatus, payload.installationGithubId);

    const pr = await this.github.getPullRequest(
      payload.installationGithubId,
      payload.owner,
      payload.repo,
      payload.pullNumber,
    );
    const changedFiles: ChangedFileRef[] = await this.github.listPullRequestFiles(
      payload.installationGithubId,
      payload.owner,
      payload.repo,
      payload.pullNumber,
    );
    if (changedFiles.length === 0) {
      return;
    }

    const intentSignals = await this.intent.collect(
      payload.installationGithubId,
      payload.owner,
      payload.repo,
      pr,
    );
    const pullRequest = await this.upsertPullRequest(repository.id, pr, intentSignals);

    const llmConfig = this.installations.resolveLlmConfig(installation);
    if (!llmConfig.apiKey) {
      await this.recordFailure(pullRequest.id, pr.headSha, 'No LLM API key configured');
      this.logger.warn(`Skipping review for ${repository.fullName}#${pr.number}: no LLM API key`);
      return;
    }

    const knowledge = await this.knowledge.retrieve(
      repository,
      installation,
      payload.installationGithubId,
      changedFiles,
      pr.headSha,
    );
    const { system, prompt } = this.promptBuilder.build(intentSignals, knowledge, changedFiles);

    const { data: output, usage } = await this.llm.completeJson<ReviewLlmOutput>(
      llmConfig.provider,
      { apiKey: llmConfig.apiKey, model: llmConfig.model, baseUrl: llmConfig.baseUrl },
      { system, prompt, maxTokens: 4096 },
    );

    const mapped = this.mapper.map(output, changedFiles);
    const githubReviewId = await this.github.createReview(payload.installationGithubId, {
      owner: payload.owner,
      repo: payload.repo,
      pullNumber: pr.number,
      commitId: pr.headSha,
      body: mapped.body,
      event: 'COMMENT',
      comments: mapped.comments,
    });

    await this.prisma.review.create({
      data: {
        pullRequestId: pullRequest.id,
        headSha: pr.headSha,
        status: 'completed',
        provider: llmConfig.provider,
        model: llmConfig.model,
        summary: output.summary,
        findings: output as unknown as Prisma.InputJsonValue,
        githubReviewId: BigInt(githubReviewId),
        tokensInput: usage.inputTokens,
        tokensOutput: usage.outputTokens,
      },
    });
    this.logger.log(
      `Reviewed ${repository.fullName}#${pr.number}: ` +
        `${mapped.comments.length} inline, ${mapped.generalFindings.length} general`,
    );
  }

  // Posts a comment on the PR when a review job is permanently dead-lettered, so the failure
  // is visible to the author instead of disappearing silently. Best-effort.
  async notifyReviewFailure(payload: ReviewPayload, error: string): Promise<void> {
    const summary = error.split('\n')[0].slice(0, 300);
    await this.github.createIssueComment(
      payload.installationGithubId,
      payload.owner,
      payload.repo,
      payload.pullNumber,
      `⚠️ **AI review failed.** I couldn't complete a review for this pull request after ` +
        `several attempts.\n\n> ${summary}\n\nComment \`/review\` to try again.`,
    );
  }

  private async ensureIndexed(
    repositoryId: string,
    indexStatus: string,
    installationGithubId: number,
  ): Promise<void> {
    if (indexStatus === 'pending') {
      await this.queue.enqueue(
        JobType.BootstrapRepository,
        { repositoryId, installationGithubId },
        { idempotencyKey: this.idempotency.bootstrapKey(repositoryId) },
      );
    }
  }

  private upsertPullRequest(
    repositoryId: string,
    pr: { number: number; title: string; body: string | null; state: string; headSha: string; baseSha: string; githubId: number },
    intent: unknown,
  ) {
    return this.prisma.pullRequest.upsert({
      where: { repositoryId_number: { repositoryId, number: pr.number } },
      create: {
        repositoryId,
        number: pr.number,
        githubPrId: BigInt(pr.githubId),
        title: pr.title,
        body: pr.body,
        state: pr.state,
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        intent: intent as Prisma.InputJsonValue,
      },
      update: {
        title: pr.title,
        body: pr.body,
        state: pr.state,
        headSha: pr.headSha,
        baseSha: pr.baseSha,
        intent: intent as Prisma.InputJsonValue,
      },
    });
  }

  private async recordFailure(pullRequestId: string, headSha: string, error: string): Promise<void> {
    await this.prisma.review.create({
      data: { pullRequestId, headSha, status: 'failed', error },
    });
  }
}
