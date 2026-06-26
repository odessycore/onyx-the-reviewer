import { AppConfigService } from '../config/app-config.service';
import { GithubApiService } from './github-api.service';
import { IdempotencyService } from '../jobs/idempotency.service';
import { JobQueueService } from '../jobs/job-queue.service';
import { JobType } from '../jobs/job-type';
import { InstallationsService } from '../installations/installations.service';
import { WebhookRouterService } from './webhook-router.service';

const BOT_LOGIN = 'onyx-the-reviewer[bot]';

describe('WebhookRouterService', () => {
  const installations = {
    ensureInstallation: jest.fn().mockResolvedValue({ id: 'inst-1' }),
    ensureRepository: jest.fn().mockResolvedValue({ id: 'repo-1' }),
    findRepositoryByGithubId: jest.fn().mockResolvedValue({ id: 'repo-1', fullName: 'acme/repo' }),
    deletePullRequest: jest.fn().mockResolvedValue(undefined),
  } as unknown as InstallationsService;
  const queue = { enqueue: jest.fn().mockResolvedValue({ enqueued: true }) } as unknown as JobQueueService;
  const idempotency = new IdempotencyService({} as never);
  const config = { botLogin: BOT_LOGIN, mentionHandle: '@onyx-the-reviewer' } as AppConfigService;
  const github = { getReviewCommentAuthor: jest.fn() } as unknown as GithubApiService;

  const router = new WebhookRouterService(installations, queue, idempotency, config, github);

  const repository = { id: 7, name: 'repo', full_name: 'acme/repo', private: true, default_branch: 'main' };
  const prPayload = {
    installation: { id: 42 },
    repository,
    pull_request: { number: 3, head: { sha: 'abc123' } },
  };

  beforeEach(() => jest.clearAllMocks());

  it('enqueues a review job for an opened PR', async () => {
    await router.route('pull_request', { ...prPayload, action: 'opened' });
    expect(queue.enqueue).toHaveBeenCalledWith(
      JobType.ReviewPullRequest,
      expect.objectContaining({ repositoryId: 'repo-1', pullNumber: 3, headSha: 'abc123' }),
      { idempotencyKey: 'review:repo-1:3:abc123' },
    );
  });

  it('cleans up DB state when a PR is closed (no review enqueued)', async () => {
    await router.route('pull_request', { ...prPayload, action: 'closed' });
    expect(installations.deletePullRequest).toHaveBeenCalledWith('repo-1', 3);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  const issueComment = (body: string, login = 'alice', commentId = 555) => ({
    action: 'created',
    installation: { id: 42 },
    repository,
    issue: { number: 3, pull_request: {} },
    comment: { id: commentId, body, user: { login, type: 'User' } },
  });

  it('enqueues a pr_command for a /explain comment on a PR', async () => {
    await router.route('issue_comment', issueComment('/explain src/x.ts'));
    expect(queue.enqueue).toHaveBeenCalledWith(
      JobType.PrCommand,
      expect.objectContaining({ channel: 'issue', pullNumber: 3, command: 'explain', target: 'src/x.ts', replyToCommentId: 555 }),
      { idempotencyKey: 'command:555' },
    );
  });

  it('ignores the bot\'s own comments (loop guard)', async () => {
    await router.route('issue_comment', issueComment('/summarize', BOT_LOGIN));
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('ignores comments that do not address the bot', async () => {
    await router.route('issue_comment', issueComment('looks good to me'));
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('ignores comments on plain issues (not PRs)', async () => {
    const payload = issueComment('/review');
    await router.route('issue_comment', { ...payload, issue: { number: 3 } });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('answers an in-thread reply to the bot without a mention', async () => {
    (github.getReviewCommentAuthor as jest.Mock).mockResolvedValue(BOT_LOGIN);
    await router.route('pull_request_review_comment', {
      action: 'created',
      installation: { id: 42 },
      repository,
      pull_request: { number: 3 },
      comment: { id: 888, body: 'but why not a map here?', in_reply_to_id: 111, user: { login: 'alice' } },
    });
    expect(queue.enqueue).toHaveBeenCalledWith(
      JobType.PrCommand,
      expect.objectContaining({ channel: 'review', anchorId: '111', command: 'ask', replyToCommentId: 888 }),
      { idempotencyKey: 'command:888' },
    );
  });

  it('ignores a review-thread reply to a human', async () => {
    (github.getReviewCommentAuthor as jest.Mock).mockResolvedValue('bob');
    await router.route('pull_request_review_comment', {
      action: 'created',
      installation: { id: 42 },
      repository,
      pull_request: { number: 3 },
      comment: { id: 889, body: 'agreed', in_reply_to_id: 222, user: { login: 'alice' } },
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
