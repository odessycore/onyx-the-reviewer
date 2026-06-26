import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { retryWithBackoff } from '../common/retry';
import { GithubClientFactory } from './github-client.factory';
import {
  CreateReviewInput,
  IssueInfo,
  PullRequestFile,
  PullRequestInfo,
  RepoTreeEntry,
} from './github.types';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const isRetryable = (error: unknown): boolean => {
  const status = (error as { status?: number }).status;
  return status === undefined || RETRYABLE_STATUSES.has(status);
};

@Injectable()
export class GithubApiService {
  constructor(private readonly clients: GithubClientFactory) {}

  async getPullRequest(
    installationId: number,
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<PullRequestInfo> {
    const client = this.clients.forInstallation(installationId);
    const { data } = await this.call(() =>
      client.pulls.get({ owner, repo, pull_number: pullNumber }),
    );
    return {
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state,
      headSha: data.head.sha,
      baseSha: data.base.sha,
      headRef: data.head.ref,
      baseRef: data.base.ref,
      githubId: data.id,
    };
  }

  async getRepository(
    installationId: number,
    owner: string,
    repo: string,
  ): Promise<{ defaultBranch: string; isPrivate: boolean }> {
    const client = this.clients.forInstallation(installationId);
    const { data } = await this.call(() => client.repos.get({ owner, repo }));
    return { defaultBranch: data.default_branch, isPrivate: data.private };
  }

  async getBranchHeadSha(
    installationId: number,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string> {
    const client = this.clients.forInstallation(installationId);
    const { data } = await this.call(() => client.repos.getBranch({ owner, repo, branch }));
    return data.commit.sha;
  }

  async listPullRequestFiles(
    installationId: number,
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<PullRequestFile[]> {
    const client = this.clients.forInstallation(installationId);
    const files = await this.call(() =>
      client.paginate(client.pulls.listFiles, { owner, repo, pull_number: pullNumber, per_page: 100 }),
    );
    return files.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    }));
  }

  async getPullRequestCommitMessages(
    installationId: number,
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string[]> {
    const client = this.clients.forInstallation(installationId);
    const commits = await this.call(() =>
      client.paginate(client.pulls.listCommits, { owner, repo, pull_number: pullNumber, per_page: 100 }),
    );
    return commits.map((commit) => commit.commit.message);
  }

  async getIssue(
    installationId: number,
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<IssueInfo | null> {
    const client = this.clients.forInstallation(installationId);
    try {
      const { data } = await this.call(() =>
        client.issues.get({ owner, repo, issue_number: issueNumber }),
      );
      return { number: data.number, title: data.title, body: data.body ?? null };
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getFileContent(
    installationId: number,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    const client = this.clients.forInstallation(installationId);
    try {
      const { data } = await this.call(() =>
        client.repos.getContent({ owner, repo, path, ref }),
      );
      if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') {
        return null;
      }
      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getTree(
    installationId: number,
    owner: string,
    repo: string,
    ref: string,
  ): Promise<RepoTreeEntry[]> {
    const client = this.clients.forInstallation(installationId);
    const { data } = await this.call(() =>
      client.git.getTree({ owner, repo, tree_sha: ref, recursive: 'true' }),
    );
    return data.tree
      .filter((entry): entry is typeof entry & { path: string; sha: string } =>
        Boolean(entry.path && entry.sha && (entry.type === 'blob' || entry.type === 'tree')),
      )
      .map((entry) => ({
        path: entry.path,
        type: entry.type as 'blob' | 'tree',
        sha: entry.sha,
        size: entry.size,
      }));
  }

  async createReview(installationId: number, input: CreateReviewInput): Promise<number> {
    const client = this.clients.forInstallation(installationId);
    const { data } = await this.call(() =>
      client.pulls.createReview({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullNumber,
        commit_id: input.commitId,
        body: input.body,
        event: input.event,
        comments: input.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side ?? 'RIGHT',
          body: comment.body,
        })),
      }),
    );
    return data.id;
  }

  async createIssueComment(
    installationId: number,
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<number> {
    const client = this.clients.forInstallation(installationId);
    const { data } = await this.call(() =>
      client.issues.createComment({ owner, repo, issue_number: issueNumber, body }),
    );
    return data.id;
  }

  async replyToReviewComment(
    installationId: number,
    owner: string,
    repo: string,
    pullNumber: number,
    inReplyToId: number,
    body: string,
  ): Promise<number> {
    const client = this.clients.forInstallation(installationId);
    const { data } = await this.call(() =>
      client.pulls.createReplyForReviewComment({
        owner,
        repo,
        pull_number: pullNumber,
        comment_id: inReplyToId,
        body,
      }),
    );
    return data.id;
  }

  async getReviewCommentAuthor(
    installationId: number,
    owner: string,
    repo: string,
    commentId: number,
  ): Promise<string | null> {
    const client = this.clients.forInstallation(installationId);
    try {
      const { data } = await this.call(() =>
        client.pulls.getReviewComment({ owner, repo, comment_id: commentId }),
      );
      return data.user?.login ?? null;
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return null;
      }
      throw error;
    }
  }

  private call<T>(fn: () => Promise<T>): Promise<T> {
    return retryWithBackoff(fn, {
      maxAttempts: 4,
      baseMs: 1000,
      capMs: 20000,
      shouldRetry: isRetryable,
    });
  }
}
