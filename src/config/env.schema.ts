import { readFileSync } from 'node:fs';
import { z } from 'zod';

const booleanFromString = z
  .string()
  .transform((value) => value === 'true' || value === '1')
  .pipe(z.boolean());

const rawEnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  ADMIN_API_TOKEN: z.string().optional(),

  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_SLUG: z.string().default('onyx-the-reviewer'),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_PRIVATE_KEY_PATH: z.string().optional(),

  LLM_PROVIDER: z.string().default('anthropic'),
  LLM_BASE_URL: z.string().optional(),
  LLM_MODEL: z.string().default('claude-opus-4-8'),
  LLM_API_KEY: z.string().optional(),

  EMBEDDING_PROVIDER: z.string().default('openai-compatible'),
  EMBEDDING_BASE_URL: z.string().default('https://api.openai.com/v1'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(1536),

  WORKER_ENABLED: booleanFromString.default('true'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  WORKER_BATCH_SIZE: z.coerce.number().default(5),
  WORKER_STUCK_JOB_TIMEOUT_MS: z.coerce.number().default(300000),
  JOB_MAX_ATTEMPTS: z.coerce.number().default(5),
  JOB_BACKOFF_BASE_MS: z.coerce.number().default(2000),
  JOB_BACKOFF_CAP_MS: z.coerce.number().default(300000),
});

export type RawEnv = z.infer<typeof rawEnvSchema>;

const resolvePrivateKey = (env: RawEnv): string => {
  if (env.GITHUB_PRIVATE_KEY && env.GITHUB_PRIVATE_KEY.trim().length > 0) {
    return env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
  }
  if (env.GITHUB_PRIVATE_KEY_PATH) {
    return readFileSync(env.GITHUB_PRIVATE_KEY_PATH, 'utf8');
  }
  throw new Error('Either GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH must be set');
};

export interface AppConfig {
  port: number;
  nodeEnv: RawEnv['NODE_ENV'];
  databaseUrl: string;
  encryptionKey: string;
  adminApiToken?: string;
  github: {
    appId: string;
    slug: string;
    webhookSecret: string;
    privateKey: string;
  };
  llm: {
    provider: string;
    baseUrl?: string;
    model: string;
    apiKey?: string;
  };
  embedding: {
    provider: string;
    baseUrl: string;
    model: string;
    apiKey?: string;
    dimensions: number;
  };
  worker: {
    enabled: boolean;
    pollIntervalMs: number;
    batchSize: number;
    maxAttempts: number;
    backoffBaseMs: number;
    backoffCapMs: number;
    stuckTimeoutMs: number;
  };
}

export const loadAppConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => {
  const env = rawEnvSchema.parse(source);
  return {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    encryptionKey: env.ENCRYPTION_KEY,
    adminApiToken: env.ADMIN_API_TOKEN,
    github: {
      appId: env.GITHUB_APP_ID,
      slug: env.GITHUB_APP_SLUG,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      privateKey: resolvePrivateKey(env),
    },
    llm: {
      provider: env.LLM_PROVIDER,
      baseUrl: env.LLM_BASE_URL,
      model: env.LLM_MODEL,
      apiKey: env.LLM_API_KEY,
    },
    embedding: {
      provider: env.EMBEDDING_PROVIDER,
      baseUrl: env.EMBEDDING_BASE_URL,
      model: env.EMBEDDING_MODEL,
      apiKey: env.EMBEDDING_API_KEY,
      dimensions: env.EMBEDDING_DIMENSIONS,
    },
    worker: {
      enabled: env.WORKER_ENABLED,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      batchSize: env.WORKER_BATCH_SIZE,
      maxAttempts: env.JOB_MAX_ATTEMPTS,
      backoffBaseMs: env.JOB_BACKOFF_BASE_MS,
      backoffCapMs: env.JOB_BACKOFF_CAP_MS,
      stuckTimeoutMs: env.WORKER_STUCK_JOB_TIMEOUT_MS,
    },
  };
};
