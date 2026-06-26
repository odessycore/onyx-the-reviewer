import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { GithubApiService } from '../github/github-api.service';
import { PullRequestInfo } from '../github/github.types';
import { ChangedFileRef } from '../knowledge/knowledge.types';
import { KnowledgeRetrieverService } from '../knowledge/knowledge-retriever.service';
import { InstallationsService } from '../installations/installations.service';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewOrchestratorService } from '../review/review-orchestrator.service';
import { ConversationPromptBuilder } from './conversation-prompt.builder';
import { ConversationService } from './conversation.service';
import { PrCommandPayload } from './conversation.types';

@Injectable()
export class ConversationOrchestratorService {
  private readonly logger = new Logger(ConversationOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly installations: InstallationsService,
    private readonly github: GithubApiService,
    private readonly knowledge: KnowledgeRetrieverService,
    private readonly conversation: ConversationService,
    private readonly promptBuilder: ConversationPromptBuilder,
    private readonly llm: LlmService,
    private readonly reviewOrchestrator: ReviewOrchestratorService,
    private readonly config: AppConfigService,
  ) {}

  async handle(payload: PrCommandPayload): Promise<void> {
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

    const llmConfig = this.installations.resolveLlmConfig(installation);
    if (!llmConfig.apiKey) {
      await this.reply(payload, 'I cannot respond — no LLM API key is configured for this installation.');
      return;
    }

    if (payload.command === 'review') {
      await this.reviewOrchestrator.review({
        repositoryId: repository.id,
        installationGithubId: payload.installationGithubId,
        owner: payload.owner,
        repo: payload.repo,
        pullNumber: payload.pullNumber,
        headSha: '',
      });
      await this.reply(payload, '🔍 Running a fresh review now.');
      return;
    }

    await this.answer(payload, repository, installation, llmConfig);
  }

  private async answer(
    payload: PrCommandPayload,
    repository: { id: string },
    installation: Parameters<InstallationsService['resolveLlmConfig']>[0],
    llmConfig: ReturnType<InstallationsService['resolveLlmConfig']>,
  ): Promise<void> {
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

    const pullRequest = await this.ensurePullRequest(repository.id, pr);
    const thread = await this.conversation.resolveThread(
      pullRequest.id,
      payload.channel,
      payload.anchorId,
    );
    await this.conversation.appendMessage(
      thread.id,
      'user',
      payload.authorLogin,
      payload.question ?? `/${payload.command} ${payload.target ?? ''}`.trim(),
      payload.replyToCommentId,
    );

    const fullRepository = await this.prisma.repository.findUniqueOrThrow({ where: { id: repository.id } });
    const knowledge = await this.knowledge.retrieve(
      fullRepository,
      installation,
      payload.installationGithubId,
      changedFiles,
      pr.headSha,
    );
    const targetFileContent =
      payload.command === 'explain' && payload.target
        ? await this.github.getFileContent(
            payload.installationGithubId,
            payload.owner,
            payload.repo,
            payload.target,
            pr.headSha,
          )
        : undefined;

    const history = await this.conversation.getHistory(thread.id);
    const { system, prompt } = this.promptBuilder.build({
      command: payload.command,
      focus: payload.focus,
      target: payload.target,
      question: payload.question,
      pr,
      changedFiles,
      knowledge,
      history,
      targetFileContent,
      botLogin: this.config.botLogin,
    });

    const { text } = await this.llm.complete(
      llmConfig.provider,
      { apiKey: llmConfig.apiKey!, model: llmConfig.model, baseUrl: llmConfig.baseUrl },
      { system, prompt, maxTokens: 2048 },
    );

    const replyId = await this.reply(payload, text);
    await this.conversation.appendMessage(thread.id, 'assistant', this.config.botLogin, text, replyId);
    this.logger.log(`Answered ${payload.command} on ${payload.owner}/${payload.repo}#${payload.pullNumber}`);
  }

  private reply(payload: PrCommandPayload, body: string): Promise<number> {
    if (payload.channel === 'review') {
      return this.github.replyToReviewComment(
        payload.installationGithubId,
        payload.owner,
        payload.repo,
        payload.pullNumber,
        payload.replyToCommentId,
        body,
      );
    }
    return this.github.createIssueComment(
      payload.installationGithubId,
      payload.owner,
      payload.repo,
      payload.pullNumber,
      body,
    );
  }

  private ensurePullRequest(repositoryId: string, pr: PullRequestInfo) {
    const data = {
      title: pr.title,
      body: pr.body,
      state: pr.state,
      headSha: pr.headSha,
      baseSha: pr.baseSha,
    };
    return this.prisma.pullRequest.upsert({
      where: { repositoryId_number: { repositoryId, number: pr.number } },
      create: { repositoryId, number: pr.number, githubPrId: BigInt(pr.githubId), ...data },
      update: data as Prisma.PullRequestUpdateInput,
    });
  }
}
