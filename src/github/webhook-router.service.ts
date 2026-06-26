import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { parseCommand } from '../conversation/command-parser';
import { ParsedCommand, PrCommandPayload } from '../conversation/conversation.types';
import { GithubApiService } from './github-api.service';
import { IdempotencyService } from '../jobs/idempotency.service';
import { JobQueueService } from '../jobs/job-queue.service';
import { JobType } from '../jobs/job-type';
import { InstallationsService } from '../installations/installations.service';
import {
  InstallationEvent,
  IssueCommentEvent,
  PullRequestEvent,
  PushEvent,
  ReviewCommentEvent,
  WebhookRepository,
} from './webhook-payloads';

const REVIEWABLE_PR_ACTIONS = new Set([
  'opened',
  'synchronize',
  'reopened',
  'ready_for_review',
]);

const ownerLogin = (repo: WebhookRepository): string =>
  repo.owner?.login ?? repo.full_name.split('/')[0];

@Injectable()
export class WebhookRouterService {
  private readonly logger = new Logger(WebhookRouterService.name);

  constructor(
    private readonly installations: InstallationsService,
    private readonly queue: JobQueueService,
    private readonly idempotency: IdempotencyService,
    private readonly config: AppConfigService,
    private readonly github: GithubApiService,
  ) {}

  async route(event: string, payload: unknown): Promise<void> {
    switch (event) {
      case 'installation':
        return this.onInstallation(payload as InstallationEvent);
      case 'installation_repositories':
        return this.onInstallationRepositories(payload as InstallationEvent);
      case 'pull_request':
        return this.onPullRequest(payload as PullRequestEvent);
      case 'push':
        return this.onPush(payload as PushEvent);
      case 'issue_comment':
        return this.onIssueComment(payload as IssueCommentEvent);
      case 'pull_request_review_comment':
        return this.onReviewComment(payload as ReviewCommentEvent);
      default:
        this.logger.debug(`Ignoring unhandled event "${event}"`);
    }
  }

  private async onInstallation(payload: InstallationEvent): Promise<void> {
    const account = payload.installation.account;
    if (payload.action === 'suspend') {
      await this.installations.setSuspended(payload.installation.id, true);
      return;
    }
    if (payload.action === 'deleted') {
      await this.installations.setSuspended(payload.installation.id, true);
      return;
    }

    const installation = await this.installations.ensureInstallation(
      payload.installation.id,
      account?.login ?? 'unknown',
      account?.type ?? 'User',
    );
    await this.bootstrapRepositories(
      installation.id,
      payload.installation.id,
      payload.repositories ?? [],
    );
  }

  private async onInstallationRepositories(payload: InstallationEvent): Promise<void> {
    if (payload.action !== 'added') {
      return;
    }
    const account = payload.installation.account;
    const installation = await this.installations.ensureInstallation(
      payload.installation.id,
      account?.login ?? 'unknown',
      account?.type ?? 'User',
    );
    await this.bootstrapRepositories(
      installation.id,
      payload.installation.id,
      payload.repositories_added ?? [],
    );
  }

  private async bootstrapRepositories(
    installationId: string,
    githubInstallationId: number,
    repos: Array<Pick<WebhookRepository, 'id' | 'name' | 'full_name' | 'private'>>,
  ): Promise<void> {
    for (const repo of repos) {
      const [owner] = repo.full_name.split('/');
      const repository = await this.installations.ensureRepository(installationId, {
        githubRepoId: repo.id,
        owner,
        name: repo.name,
        fullName: repo.full_name,
        isPrivate: repo.private,
      });
      await this.queue.enqueue(
        JobType.BootstrapRepository,
        { repositoryId: repository.id, installationGithubId: githubInstallationId },
        { idempotencyKey: this.idempotency.bootstrapKey(repository.id) },
      );
    }
  }

  private async onPullRequest(payload: PullRequestEvent): Promise<void> {
    if (payload.action === 'closed') {
      return this.onPullRequestClosed(payload);
    }
    if (!REVIEWABLE_PR_ACTIONS.has(payload.action) || payload.pull_request.draft) {
      return;
    }
    const repo = payload.repository;
    const installation = await this.installations.ensureInstallation(
      payload.installation.id,
      ownerLogin(repo),
      'Organization',
    );
    const repository = await this.installations.ensureRepository(installation.id, {
      githubRepoId: repo.id,
      owner: ownerLogin(repo),
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
    });

    const headSha = payload.pull_request.head.sha;
    await this.queue.enqueue(
      JobType.ReviewPullRequest,
      {
        repositoryId: repository.id,
        installationGithubId: payload.installation.id,
        owner: ownerLogin(repo),
        repo: repo.name,
        pullNumber: payload.pull_request.number,
        headSha,
      },
      { idempotencyKey: this.idempotency.reviewKey(repository.id, payload.pull_request.number, headSha) },
    );
  }

  // On close/merge, wipe all DB state for the PR (review history + conversations) via cascade.
  private async onPullRequestClosed(payload: PullRequestEvent): Promise<void> {
    const repository = await this.installations.findRepositoryByGithubId(payload.repository.id);
    if (!repository) {
      return;
    }
    await this.installations.deletePullRequest(repository.id, payload.pull_request.number);
    this.logger.log(`Cleaned up data for ${repository.fullName}#${payload.pull_request.number}`);
  }

  private async onIssueComment(payload: IssueCommentEvent): Promise<void> {
    if (payload.action !== 'created' || !payload.issue.pull_request) {
      return;
    }
    if (this.isSelf(payload.comment.user.login) || !this.isDirectedAtBot(payload.comment.body)) {
      return;
    }
    const parsed = parseCommand(payload.comment.body, this.config.mentionHandle);
    await this.enqueueCommand(payload.installation.id, payload.repository, {
      pullNumber: payload.issue.number,
      channel: 'issue',
      anchorId: 'pr',
      replyToCommentId: payload.comment.id,
      authorLogin: payload.comment.user.login,
      parsed,
    });
  }

  private async onReviewComment(payload: ReviewCommentEvent): Promise<void> {
    if (payload.action !== 'created' || this.isSelf(payload.comment.user.login)) {
      return;
    }
    const directed =
      this.isDirectedAtBot(payload.comment.body) ||
      (await this.isReplyToBot(payload));
    if (!directed) {
      return;
    }
    const parsed = parseCommand(payload.comment.body, this.config.mentionHandle);
    await this.enqueueCommand(payload.installation.id, payload.repository, {
      pullNumber: payload.pull_request.number,
      channel: 'review',
      anchorId: String(payload.comment.in_reply_to_id ?? payload.comment.id),
      replyToCommentId: payload.comment.id,
      authorLogin: payload.comment.user.login,
      parsed,
    });
  }

  private async enqueueCommand(
    githubInstallationId: number,
    repo: WebhookRepository,
    fields: {
      pullNumber: number;
      channel: PrCommandPayload['channel'];
      anchorId: string;
      replyToCommentId: number;
      authorLogin: string;
      parsed: ParsedCommand;
    },
  ): Promise<void> {
    const installation = await this.installations.ensureInstallation(
      githubInstallationId,
      ownerLogin(repo),
      'Organization',
    );
    const repository = await this.installations.ensureRepository(installation.id, {
      githubRepoId: repo.id,
      owner: ownerLogin(repo),
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
    });

    const payload: PrCommandPayload = {
      repositoryId: repository.id,
      installationGithubId: githubInstallationId,
      owner: ownerLogin(repo),
      repo: repo.name,
      pullNumber: fields.pullNumber,
      channel: fields.channel,
      anchorId: fields.anchorId,
      replyToCommentId: fields.replyToCommentId,
      authorLogin: fields.authorLogin,
      command: fields.parsed.command,
      focus: fields.parsed.focus,
      target: fields.parsed.target,
      question: fields.parsed.question,
    };
    await this.queue.enqueue(JobType.PrCommand, { ...payload }, {
      idempotencyKey: this.idempotency.commandKey(fields.replyToCommentId),
    });
  }

  private isSelf(login: string): boolean {
    return login === this.config.botLogin;
  }

  private isDirectedAtBot(body: string): boolean {
    return body.trimStart().startsWith('/') || body.includes(this.config.mentionHandle);
  }

  private async isReplyToBot(payload: ReviewCommentEvent): Promise<boolean> {
    if (!payload.comment.in_reply_to_id) {
      return false;
    }
    const parentAuthor = await this.github.getReviewCommentAuthor(
      payload.installation.id,
      ownerLogin(payload.repository),
      payload.repository.name,
      payload.comment.in_reply_to_id,
    );
    return parentAuthor === this.config.botLogin;
  }

  private async onPush(payload: PushEvent): Promise<void> {
    const repo = payload.repository;
    if (payload.ref !== `refs/heads/${repo.default_branch}`) {
      return;
    }
    const repository = await this.installations.findRepositoryByGithubId(repo.id);
    if (!repository) {
      return;
    }
    await this.queue.enqueue(
      JobType.RefreshIndex,
      {
        repositoryId: repository.id,
        installationGithubId: payload.installation.id,
        owner: ownerLogin(repo),
        repo: repo.name,
        sha: payload.after,
      },
      { idempotencyKey: this.idempotency.refreshKey(repository.id, payload.after) },
    );
  }
}
