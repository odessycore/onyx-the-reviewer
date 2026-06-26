import 'dotenv/config';

// Test environment must be set before the app (and its config) is constructed.
process.env.GITHUB_APP_ID = '1';
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

const GITHUB_INSTALLATION_ID = 9942;
const GITHUB_REPO_ID = 7777;

const githubMock = {
  getPullRequest: jest.fn().mockResolvedValue({
    number: 3,
    title: 'Add feature',
    body: 'Implements the thing',
    state: 'open',
    headSha: 'headsha123',
    baseSha: 'basesha000',
    headRef: 'feature',
    baseRef: 'main',
    githubId: 555,
  }),
  listPullRequestFiles: jest.fn().mockResolvedValue([
    {
      filename: 'src/x.ts',
      status: 'modified',
      additions: 2,
      deletions: 0,
      patch: '@@ -0,0 +1,2 @@\n+const x = 1;\n+const y = 2;',
    },
  ]),
  getPullRequestCommitMessages: jest.fn().mockResolvedValue(['Add feature']),
  getIssue: jest.fn().mockResolvedValue(null),
  getFileContent: jest.fn().mockResolvedValue('const x = 1;\nconst y = 2;'),
  createReview: jest.fn().mockResolvedValue(321),
};

const llmMock = {
  completeJson: jest.fn().mockResolvedValue({
    data: {
      summary: 'Adds two constants.',
      intent: 'Implement the thing',
      intentAssessment: 'The diff matches the stated intent.',
      confidence: 'high',
      findings: [
        { path: 'src/x.ts', line: 1, severity: 'major', title: 'Example', body: 'Detail.' },
      ],
    },
    usage: { inputTokens: 10, outputTokens: 5 },
  }),
};

const pullRequestPayload = (action: string) => ({
  action,
  installation: { id: GITHUB_INSTALLATION_ID },
  repository: {
    id: GITHUB_REPO_ID,
    name: 'repo',
    full_name: 'acme/repo',
    private: true,
    default_branch: 'main',
  },
  pull_request: { number: 3, head: { sha: 'headsha123' } },
});

const post = (app: INestApplication, event: string, deliveryId: string, payload: unknown) => {
  const raw = JSON.stringify(payload);
  const signature =
    'sha256=' + createHmac('sha256', 'e2e-secret').update(raw).digest('hex');
  return request(app.getHttpServer())
    .post('/webhooks/github')
    .set('content-type', 'application/json')
    .set('x-github-event', event)
    .set('x-github-delivery', deliveryId)
    .set('x-hub-signature-256', signature)
    .send(raw);
};

const waitFor = async <T>(fn: () => Promise<T | null>, timeoutMs = 8000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for condition');
};

describe('Webhook -> async review (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GithubApiService)
      .useValue(githubMock)
      .overrideProvider(LlmService)
      .useValue(llmMock)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.useBodyParser('json');
    await app.init();

    prisma = app.get(PrismaService);
    await resetData(prisma);
    await seedReadyRepository(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await resetData(prisma);
    }
    await app?.close();
  });

  it('reviews a pull request opened webhook and posts exactly one review', async () => {
    const response = await post(app, 'pull_request', 'delivery-1', pullRequestPayload('opened'));
    expect(response.status).toBe(202);

    const review = await waitFor(() =>
      prisma.review.findFirst({ where: { status: 'completed', headSha: 'headsha123' } }),
    );
    expect(review).toBeTruthy();
    expect(githubMock.createReview).toHaveBeenCalledTimes(1);

    const reviewArg = githubMock.createReview.mock.calls[0][1];
    expect(reviewArg.event).toBe('COMMENT');
    expect(reviewArg.comments).toHaveLength(1);
    expect(reviewArg.comments[0]).toMatchObject({ path: 'src/x.ts', line: 1 });
  });

  it('drops a redelivered webhook without creating a second review', async () => {
    const before = await prisma.review.count();
    const response = await post(app, 'pull_request', 'delivery-1', pullRequestPayload('opened'));
    expect(response.body.status).toBe('duplicate');

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await prisma.review.count()).toBe(before);
  });
});

async function resetData(prisma: PrismaService): Promise<void> {
  await prisma.job.deleteMany({});
  await prisma.webhookDelivery.deleteMany({});
  await prisma.installation.deleteMany({
    where: { githubInstallationId: BigInt(GITHUB_INSTALLATION_ID) },
  });
}

// Seed the repo as already indexed so the review path runs without a bootstrap job.
async function seedReadyRepository(prisma: PrismaService): Promise<void> {
  const installation = await prisma.installation.create({
    data: {
      githubInstallationId: BigInt(GITHUB_INSTALLATION_ID),
      accountLogin: 'acme',
      accountType: 'Organization',
    },
  });
  await prisma.repository.create({
    data: {
      installationId: installation.id,
      githubRepoId: BigInt(GITHUB_REPO_ID),
      owner: 'acme',
      name: 'repo',
      fullName: 'acme/repo',
      defaultBranch: 'main',
      indexStatus: 'indexing',
    },
  });
}
