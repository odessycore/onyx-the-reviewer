# AI PR Reviewer

A GitHub-first, **LLM-agnostic** pull request reviewer built with NestJS. Install it as a GitHub
App on any repository; when a PR is opened or updated it asynchronously reviews the diff — with
real repository context — and posts a GitHub Review (summary + inline comments). It also holds
**stateful conversations** in PR comments. Postgres (with `pgvector`) is the only infrastructure
dependency — no queues, no cloud services.

---

## Feature breakdown

### Automated PR review
- Reviews on `opened` / `synchronize` / `reopened` / `ready_for_review`.
- Posts **one GitHub Review** = a top-level summary + inline line comments.
- **Intent-aware**: infers the PR's goal from title/body → linked issues (`Closes #123`) →
  commit messages, then assesses whether the diff achieves it before reviewing the code.
- **Safe inline anchoring**: a finding becomes an inline comment only if its line is in the diff;
  off-diff findings are folded into the summary (never silently dropped).

### Repository knowledge (RAG)
- On install / push to the default branch, the repo is indexed into **pgvector**: source is
  chunked, embedded, and stored; a lightweight "repo profile" (README, manifests, languages,
  tree) is cached.
- At review time the bot combines the cached profile, **semantically-retrieved** code chunks
  (cosine search over an HNSW index), and the live changed files.
- Knowledge acquisition is fully decoupled from review time — a review never blocks on indexing.

### Conversational bot
- **Commands** in PR comments: `/review`, `/review --focus <area>`, `/explain <file>`, `/summarize`.
- **Free-form**: `@your-app <question>` or a plain reply in a bot's review thread is answered.
- **Stateful**: per-PR/per-thread history is persisted and fed back into the model, so it follows
  the conversation. Self-loop guarded (never replies to itself) and idempotent per comment.

### Async engine & reliability
- Custom **Postgres-backed job queue** claimed with `FOR UPDATE SKIP LOCKED` (multi-instance safe).
- **Idempotency** at two layers: webhook delivery ids and per-job idempotency keys.
- **Retries** with full-jitter exponential backoff, dead-lettering after a configurable cap, plus
  in-process retry around every outbound GitHub/LLM/embedding call.

### Provider-agnostic AI
- **Chat** behind an `LlmProvider` interface: `anthropic` and `openai-compatible` (OpenAI, HF
  router, vLLM, Ollama, LM Studio…) included.
- **Embeddings** behind a separate `EmbeddingProvider`: `huggingface` (feature-extraction) and
  `openai-compatible` included. Bring your own keys per installation.

### Operational
- Per-installation settings via an admin API; **API keys encrypted at rest** (AES-256-GCM).
- Liveness/readiness probes; PR data is **deleted on close/merge** (cascade cleanup).

> Deep dives: [`docs/SCHEMA.md`](docs/SCHEMA.md) (data model) and
> [`docs/FLOWS.md`](docs/FLOWS.md) (request/data flows).

---

## Technologies used

| Area | Technology |
|---|---|
| Runtime | Node.js 20+ (developed on 24), TypeScript |
| Framework | [NestJS 11](https://nestjs.com/) (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/schedule`) |
| Database | PostgreSQL 17 + [`pgvector`](https://github.com/pgvector/pgvector) (HNSW cosine index) |
| ORM / migrations | [Prisma 6](https://www.prisma.io/) (raw SQL for the queue dequeue & vector ops) |
| GitHub | GitHub App via [`@octokit/rest`](https://github.com/octokit) + `@octokit/auth-app` |
| Chat LLM | `@anthropic-ai/sdk`; OpenAI-compatible adapter via `fetch` |
| Embeddings | OpenAI-compatible / HuggingFace feature-extraction via `fetch` |
| Config / validation | [`zod`](https://zod.dev/), `dotenv` |
| Tests | Jest + Supertest (unit + e2e against a real DB) |

Architecture is a set of NestJS modules with clear separation of concerns: `config`, `common`
(backoff/retry/encryption), `prisma`, `jobs` (the engine), `github` (auth/API/webhooks), `llm`,
`knowledge` (indexing/retrieval), `review`, `conversation`, `installations`, `health`.

---

## Setup instructions

### 1. Prerequisites

- **Node.js 20+** and npm.
- **Docker** (for the bundled Postgres + pgvector), or any PostgreSQL 14+ with the `vector`
  extension available.
- A **GitHub account/org** where you can create and install a GitHub App.
- An **LLM API key** (e.g. Anthropic, OpenAI, or a HuggingFace token) and an **embeddings**
  endpoint/key.

### 2. Clone and install

```bash
git clone <your-repo-url> ai-pr-reviewer
cd ai-pr-reviewer
npm install
```

### 3. Start the database

The bundled compose file runs `pgvector/pgvector:pg17`, mapping host port **5433** → container
5432 (5433 avoids clashing with any local Postgres on 5432):

```bash
docker compose up -d
# verify it is accepting connections
pg_isready -h localhost -p 5433
```

> No Docker? Point `DATABASE_URL` at any Postgres that has `pgvector`, and run
> `CREATE EXTENSION IF NOT EXISTS vector;` once (Prisma also creates it via migration).

### 4. Configure environment

```bash
cp .env.example .env
# generate the at-rest encryption key (32 bytes):
openssl rand -base64 32   # paste into ENCRYPTION_KEY
```

Edit `.env`. Full variable reference:

| Variable | Required | Description |
|---|---|---|
| `PORT` | no | HTTP port (default `3000`). |
| `NODE_ENV` | no | `development` \| `test` \| `production`. |
| `DATABASE_URL` | **yes** | Postgres connection string (default targets the compose DB on 5433). |
| `ENCRYPTION_KEY` | **yes** | Key used to encrypt stored API keys. `openssl rand -base64 32`. |
| `GITHUB_APP_ID` | **yes** | Numeric App ID from the GitHub App settings. |
| `GITHUB_APP_SLUG` | **yes** | The App's slug (from its page URL). Used for `@mentions` and to ignore the bot's own comments. |
| `GITHUB_WEBHOOK_SECRET` | **yes** | Must equal the webhook secret configured on the App. |
| `GITHUB_PRIVATE_KEY` | one of | PEM contents (use literal `\n` for newlines)… |
| `GITHUB_PRIVATE_KEY_PATH` | …or | …a path to the downloaded `.pem` file. |
| `LLM_PROVIDER` | no | `anthropic` \| `openai-compatible` (default `anthropic`). |
| `LLM_BASE_URL` | for openai-compatible | Base URL, e.g. `https://router.huggingface.co/v1`. |
| `LLM_MODEL` | no | Model id (e.g. `claude-opus-4-8`, `meta-llama/Llama-3.3-70B-Instruct`). |
| `LLM_API_KEY` | **yes** | Default chat key (overridable per installation). |
| `EMBEDDING_PROVIDER` | no | `openai-compatible` \| `huggingface` (default `openai-compatible`). |
| `EMBEDDING_BASE_URL` | **yes** | e.g. `https://api.openai.com/v1` or `https://router.huggingface.co/hf-inference`. |
| `EMBEDDING_MODEL` | **yes** | e.g. `text-embedding-3-small` or `BAAI/bge-small-en-v1.5`. |
| `EMBEDDING_API_KEY` | **yes** | Embeddings key/token. |
| `EMBEDDING_DIMENSIONS` | **yes** | Must match the model **and** the `vector(N)` column in `prisma/schema.prisma`. |
| `WORKER_ENABLED` | no | Run the job worker in this process (default `true`). |
| `WORKER_POLL_INTERVAL_MS` | no | Worker poll cadence (default `2000`). |
| `WORKER_BATCH_SIZE` | no | Jobs claimed per tick (default `5`). |
| `JOB_MAX_ATTEMPTS` | no | Retries before dead-lettering (default `5`). |
| `JOB_BACKOFF_BASE_MS` / `JOB_BACKOFF_CAP_MS` | no | Backoff base/cap (default `2000` / `300000`). |
| `ADMIN_API_TOKEN` | no | Enables the per-installation settings API. Disabled when unset. |

> **Embeddings gotcha (HuggingFace):** HF's chat router (`router.huggingface.co/v1`) does **not**
> serve `/embeddings`. For HF embeddings use `EMBEDDING_PROVIDER=huggingface`,
> `EMBEDDING_BASE_URL=https://router.huggingface.co/hf-inference`,
> `EMBEDDING_MODEL=BAAI/bge-small-en-v1.5`, and **`EMBEDDING_DIMENSIONS=384`** (bge-small is
> 384-dim). The default schema column is `vector(384)`; if you switch to a different-dimension
> model, change the column in `prisma/schema.prisma` and the migration too.

### 5. Apply migrations

```bash
npm run prisma:generate   # generate the typed client
npm run prisma:deploy     # apply migrations (creates the vector extension, tables, HNSW index)
```

### 6. Register the GitHub App

In GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**:

1. **Webhook URL:** `https://<your-public-host>/webhooks/github` (see step 7 for local tunneling).
2. **Webhook secret:** the same value as `GITHUB_WEBHOOK_SECRET`.
3. **Repository permissions:**
   - *Contents*: **Read** (fetch files/tree for indexing & review)
   - *Pull requests*: **Read & write** (read diffs, post reviews/replies)
   - *Issues*: **Read & write** (receive `issue_comment` events, post conversation replies)
   - *Metadata*: **Read** (mandatory)
4. **Subscribe to events:** *Pull request*, *Push*, *Installation*, *Installation repositories*,
   *Issue comment*, *Pull request review comment*.
5. **Generate a private key** → set `GITHUB_PRIVATE_KEY` (or `GITHUB_PRIVATE_KEY_PATH`).
6. Note the **App ID** → `GITHUB_APP_ID`, and the **slug** (in the App's public URL) →
   `GITHUB_APP_SLUG`.
7. **Install** the App on a repository. The `installation` webhook triggers the initial index.

> If you change permissions/events later, GitHub prompts each install to re-accept them.

### 7. Expose webhooks (local development)

GitHub must reach your machine. Use a tunnel and set the App's webhook URL to it:

```bash
# option A: ngrok
ngrok http 3000          # use the https URL + /webhooks/github

# option B: smee.io
npx smee-client --url https://smee.io/<channel> --target http://localhost:3000/webhooks/github
```

### 8. Run

```bash
npm run start:dev     # watch mode
# or
npm run build && npm run start:prod
```

You should see the worker start and all job handlers register:

```
[JobHandlerRegistry] Registered handler for job type "bootstrap_repository"
[JobHandlerRegistry] Registered handler for job type "refresh_index"
[JobHandlerRegistry] Registered handler for job type "review_pull_request"
[JobHandlerRegistry] Registered handler for job type "pr_command"
[Bootstrap] AI PR Reviewer listening on port 3000
```

Health checks: `GET /health` (liveness), `GET /health/ready` (DB readiness).

### 9. (Optional) Per-installation configuration

Set `ADMIN_API_TOKEN` to enable the settings API, then override the provider/model/keys for a
single installation (keys are encrypted before storage and never returned):

```bash
curl -X PATCH http://localhost:3000/installations/<githubInstallationId>/settings \
  -H "x-admin-token: $ADMIN_API_TOKEN" -H 'content-type: application/json' \
  -d '{"llmProvider":"openai-compatible","llmModel":"meta-llama/Llama-3.3-70B-Instruct","llmApiKey":"hf_..."}'
```

---

## Using the bot

Open a PR and the review posts automatically. In any PR comment:

| Comment | Effect |
|---|---|
| `/review` | Re-run a full review now. |
| `/review --focus security` | Review with an emphasis. |
| `/explain src/foo.ts` | Explain a file/area in the PR's context. |
| `/summarize` | Summarize what the PR does and its risks. |
| `@your-app why is this O(n²)?` | Free-form question (answered with PR + repo context). |
| *(reply in the bot's review thread)* | Continues the conversation with memory of the thread. |

Closing/merging the PR deletes all of its stored data (reviews + conversations).

---

## Testing

```bash
npm test        # unit tests (backoff/jitter, retry, signature verify, JSON extraction,
                # review mapping, command parsing, webhook routing/idempotency)
npm run test:e2e  # e2e against the running Postgres: webhook → job → review, and the
                  # conversation + PR-close cleanup flows (GitHub & LLM mocked)
npm run build     # type-check + compile
```

---

## Project structure

```
src/
  config/         Typed, zod-validated environment configuration
  common/         Backoff/retry helpers, AES-256-GCM encryption
  prisma/         PrismaService (Postgres + pgvector)
  jobs/           Async engine: queue, worker (SKIP LOCKED), idempotency, retry/backoff
  github/         App auth, Octokit factory, REST wrappers, webhook verify + router
  llm/            LlmProvider abstraction (anthropic, openai-compatible) + registry
  knowledge/      Embeddings, repo profile, indexer (pgvector), retriever, index handlers
  review/         Intent, prompt builder, result mapper, orchestrator, review handler
  conversation/   Command parser, thread/message store, prompt builder, orchestrator, handler
  installations/  Per-installation settings (encrypted keys) + admin API
  health/         Liveness / readiness probes
prisma/           schema.prisma + migrations
docs/             SCHEMA.md, FLOWS.md
test/             e2e specs
```
