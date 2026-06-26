import 'dotenv/config';

process.env.GITHUB_APP_ID = '1';
process.env.GITHUB_APP_SLUG = 'onyx-the-reviewer';
process.env.GITHUB_PRIVATE_KEY = 'dummy-key';
process.env.GITHUB_WEBHOOK_SECRET = 'e2e-secret';
process.env.ENCRYPTION_KEY = 'e2e-encryption-key';
process.env.LLM_PROVIDER = 'openai-compatible';
process.env.LLM_BASE_URL = 'http://localhost/v1';
process.env.LLM_API_KEY = 'test-llm-key';
process.env.WORKER_POLL_INTERVAL_MS = '150';

import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GithubApiService } from '../src/github/github-api.service';
import { LlmService } from '../src/llm/llm.service';
import { PrismaService } from '../src/prisma/prisma.service';

const GH_INSTALLATION = 9943;
const GH_REPO = 7778;

const githubMock = {
  getPullRequest: jest.fn().mockResolvedValue({
    number: 5, title: 'Add cache', body: 'Speeds things up', state: 'open',
    headSha: 'sha5', baseSha: 'base5', headRef: 'feat', baseRef: 'main', githubId: 600,
  }),
  listPullRequestFiles: jest.fn().mockResolvedValue([
    { filename: 'src/cache.ts', status: 'added', additions: 5, deletions: 0, patch: '@@ -0,0 +1,1 @@\n+export const c = 1;' },
  ]),
  getFileContent: jest.fn().mockResolvedValue('export const c = 1;'),
  createIssueComment: jest.fn().mockResolvedValue(9001),
};

const llmMock = {
  complete: jest.fn().mockResolvedValue({
    text: 'This PR adds a cache module to speed up lookups.',
    usage: { inputTokens: 12, outputTokens: 9 },
  }),
};

const sign = (raw: string) =>
  'sha256=' + createHmac('sha256', 'e2e-secret').update(raw).digest('hex');

const post = (app: INestApplication, event: string, deliveryId: string, payload: unknown) => {
  const raw = JSON.stringify(payload);
  return request(app.getHttpServer())
    .post('/webhooks/github')
    .set('content-type', 'application/json')
    .set('x-github-event', event)
    .set('x-github-delivery', deliveryId)
    .set('x-hub-signature-256', sign(raw))
    .send(raw);
};

const waitFor = async <T>(fn: () => Promise<T | null>, timeoutMs = 8000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for condition');
};

const issueComment = (deliveryId: string) => ({
  action: 'created',
  installation: { id: GH_INSTALLATION },
  repository: { id: GH_REPO, name: 'repo', full_name: 'acme/repo', private: true, default_branch: 'main' },
  issue: { number: 5, pull_request: {} },
  comment: { id: 4242, body: '@onyx-the-reviewer what does this PR do?', user: { login: 'alice', type: 'User' } },
});

describe('Conversation commands (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GithubApiService).useValue(githubMock)
      .overrideProvider(LlmService).useValue(llmMock)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.useBodyParser('json');
    await app.init();

    prisma = app.get(PrismaService);
    await reset(prisma);
    await seed(prisma);
  });

  afterAll(async () => {
    if (prisma) await reset(prisma);
    await app?.close();
  });

  it('answers an @mention and persists the conversation', async () => {
    const res = await post(app, 'issue_comment', 'c-delivery-1', issueComment('c-delivery-1'));
    expect(res.status).toBe(202);

    await waitFor(() =>
      githubMock.createIssueComment.mock.calls.length > 0 ? Promise.resolve(true) : Promise.resolve(null),
    );

    const messages = await prisma.conversationMessage.findMany({ orderBy: { createdAt: 'asc' } });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].body).toContain('cache');
    expect(llmMock.complete).toHaveBeenCalledTimes(1);
  });

  it('deletes all PR data when the PR is closed', async () => {
    const pr = await prisma.pullRequest.findFirst({ where: { number: 5 } });
    expect(pr).toBeTruthy();

    await post(app, 'pull_request', 'c-delivery-2', {
      action: 'closed',
      installation: { id: GH_INSTALLATION },
      repository: { id: GH_REPO, name: 'repo', full_name: 'acme/repo', private: true, default_branch: 'main' },
      pull_request: { number: 5, head: { sha: 'sha5' } },
    });

    await waitFor(async () =>
      (await prisma.pullRequest.count({ where: { number: 5 } })) === 0 ? true : null,
    );
    expect(await prisma.conversationMessage.count()).toBe(0);
    expect(await prisma.conversationThread.count()).toBe(0);
  });
});

async function reset(prisma: PrismaService): Promise<void> {
  await prisma.job.deleteMany({});
  await prisma.webhookDelivery.deleteMany({});
  await prisma.installation.deleteMany({ where: { githubInstallationId: BigInt(GH_INSTALLATION) } });
}

async function seed(prisma: PrismaService): Promise<void> {
  const installation = await prisma.installation.create({
    data: { githubInstallationId: BigInt(GH_INSTALLATION), accountLogin: 'acme', accountType: 'Organization' },
  });
  await prisma.repository.create({
    data: {
      installationId: installation.id, githubRepoId: BigInt(GH_REPO),
      owner: 'acme', name: 'repo', fullName: 'acme/repo', defaultBranch: 'main', indexStatus: 'indexing',
    },
  });
}
