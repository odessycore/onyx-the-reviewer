# Application Flows

Developer reference for how data moves through the app. Pairs with
[`SCHEMA.md`](./SCHEMA.md). File paths are under `src/` unless noted.

## Architectural principle: ingest fast, work async

Every webhook handler does the minimum synchronous work — verify, dedupe, persist a `Job` — and
returns `202`. All real work (indexing, LLM calls, posting comments) happens later in the
**worker**, off the request path. So almost every flow is two phases:

```
HTTP request  →  enqueue Job (durable)        [webhook.controller.ts → webhook-router.service.ts]
Job worker    →  handler does the work        [job.worker.ts → *Handler → *OrchestratorService]
```

---

## Flow A — Webhook ingress (shared by every event)

Entry: `POST /webhooks/github` → `WebhookController.handle()` (`github/webhook.controller.ts`).

1. **Raw body capture.** `main.ts` creates the app with `{ rawBody: true }` so the exact bytes
   are available for signature verification (`request.rawBody`). Body limit raised via
   `app.useBodyParser('json', { limit: '10mb' })`.
2. **Signature check.** `WebhookVerificationService.verify(rawBody, signature)`
   (`github/webhook-verification.service.ts`) computes `HMAC-SHA256(secret, rawBody)` and compares
   to `X-Hub-Signature-256` with `crypto.timingSafeEqual`. Failure → `401`.
3. **Delivery dedupe (idempotency line 1).** `IdempotencyService.registerDelivery(deliveryId, …)`
   inserts `WebhookDelivery`; a unique-violation on `X-GitHub-Delivery` means we've seen this
   redelivery → return `{ status: 'duplicate' }` without doing anything.
4. **Route.** `WebhookRouterService.route(event, payload)` (`github/webhook-router.service.ts`)
   switches on the event and enqueues the appropriate job. Returns `202 { status: 'accepted' }`.

`route()` mapping:

| Event | Handler | Enqueues |
|---|---|---|
| `installation`, `installation_repositories` | `onInstallation*` → `bootstrapRepositories()` | `bootstrap_repository` |
| `pull_request` (opened/synchronize/reopened/ready) | `onPullRequest()` | `review_pull_request` |
| `pull_request` (closed) | `onPullRequestClosed()` | — (deletes PR, see Flow E) |
| `push` (to default branch) | `onPush()` | `refresh_index` |
| `issue_comment`, `pull_request_review_comment` | `onIssueComment` / `onReviewComment` | `pr_command` |

All enqueues go through `JobQueueService.enqueue(type, payload, { idempotencyKey })`.

---

## Flow B — The async job engine (how any job runs)

This underpins every other flow. Files: `jobs/job-queue.service.ts`, `jobs/job.worker.ts`,
`jobs/job-handler.ts`, `common/backoff.ts`, `common/retry.ts`.

**Enqueue** — `JobQueueService.enqueue()` inserts a `Job` row. If an `idempotencyKey` collides
(unique index) it catches Prisma `P2002` and **no-ops** (idempotency line 2). Key shapes live in
`IdempotencyService`: `bootstrap:{repoId}`, `refresh:{repoId}:{sha}`,
`review:{repoId}:{pr}:{headSha}`, `command:{commentId}`.

**Claim** — `JobWorker` (`onModuleInit` starts a `setInterval` → `tick()`). `claimBatch()` runs a
single atomic statement:

```sql
UPDATE "Job" SET status='running', "lockedAt"=now(), "lockedBy"=$worker, attempts=attempts+1
WHERE id IN (
  SELECT id FROM "Job" WHERE status='pending' AND "runAt" <= now()
  ORDER BY "runAt" FOR UPDATE SKIP LOCKED LIMIT $batch
) RETURNING …
```

`FOR UPDATE SKIP LOCKED` lets multiple workers/instances pull disjoint rows without blocking.
`attempts` is incremented at claim time.

**Dispatch** — `process()` looks up the handler via `JobHandlerRegistry.get(job.type)` and calls
`handler.handle(payload, ctx)`. Handlers self-register in their own `onModuleInit`
(`registry.register(this)`), which keeps the worker decoupled from feature modules (no circular
deps). Registered types: `bootstrap_repository`, `refresh_index`, `review_pull_request`,
`pr_command`.

**Outcome:**
- success → `complete()` sets `status='completed'`, clears the lock.
- throw → `onFailure()`: if `attempts >= maxAttempts` → `deadLetter()` (`status='failed'`);
  else reschedule `status='pending'`, `runAt = now + fullJitterDelayMs(attempts, …)`
  (`common/backoff.ts`: `random() * min(cap, base * 2^(attempt-1))`).

Outbound API calls (GitHub, LLM, embeddings) are *separately* wrapped in
`retryWithBackoff()` (`common/retry.ts`) for transient `429/5xx`, so a flaky call retries
in-process before the job-level retry ever triggers.

---

## Flow C — Repository knowledge ingestion (RAG index)

**When it runs:** on install (`bootstrap_repository`), on push to the default branch
(`refresh_index`), and lazily if a review finds `indexStatus='pending'`
(`ReviewOrchestratorService.ensureIndexed()`).

Handlers `knowledge/handlers/bootstrap-repository.handler.ts` and `refresh-index.handler.ts`
both call `RepoIndexerService.indexRepository(repository, installationGithubId)`
(`knowledge/repo-indexer.service.ts`). `refresh_index` first skips if `repository.indexedSha`
already equals the pushed sha.

`indexRepository()` step by step:

1. Mark `Repository.indexStatus = 'indexing'`.
2. Resolve embedding config — `InstallationsService.resolveEmbeddingConfig()` (decrypts the key,
   falls back to env). Returns `{ provider, baseUrl, model, apiKey, dimensions }`.
3. Discover the tree — `GithubApiService.getRepository()` → `getBranchHeadSha()` → `getTree()`.
4. Build the repo profile — `RepoProfileService.buildProfile()` (`knowledge/repo-profile.service.ts`):
   README/CONTRIBUTING excerpts, manifest files, language histogram, top-level entries.
5. `collectChunks()` — for each tree blob passing `isIndexablePath()` and the size cap
   (`MAX_INDEXABLE_FILE_BYTES`, `knowledge/chunking.ts`), fetch content (`getFileContent`) and
   split into overlapping line windows via `chunkFile()`. Capped by `MAX_FILES` / `MAX_CHUNKS`.
6. Embed — `EmbeddingService.embedBatch()` (`knowledge/embedding/embedding.service.ts`) batches
   (64) and dispatches to the provider chosen by `config.provider` through
   `EmbeddingProviderRegistry`: `HuggingFaceEmbeddingProvider` (feature-extraction pipeline) or
   `OpenAiCompatibleEmbeddingProvider` (`/embeddings`).
7. `replaceChunks()` — inside a `$transaction`: `deleteMany` existing chunks, then bulk-insert
   with raw SQL because the vector type isn't a Prisma type:
   `INSERT … VALUES (…, ${'[' + vec.join(',') + ']'}::vector)` built with `Prisma.sql` +
   `Prisma.join`, in batches of 300.
8. Mark `indexStatus='ready'`, set `indexedSha`, `indexedAt`, store `profile`.

On any error: set `indexStatus='failed'` and rethrow → the job engine retries with backoff
(Flow B). Reviews still run on a failed index (retrieval just returns no chunks).

**Retrieval at review time** — `KnowledgeRetrieverService.retrieve()`
(`knowledge/knowledge-retriever.service.ts`):
- `profile` is read straight off `Repository.profile`.
- `searchRelevantChunks()` (only if `indexStatus='ready'`): embed a query built from the changed
  files' paths+patches (`EmbeddingService.embedOne`), then cosine-search pgvector:
  `ORDER BY embedding <=> $query::vector LIMIT 12` (uses the HNSW index).
- `fetchChangedFiles()`: lazily fetch full content of changed files (`getFileContent`) for
  immediate, always-fresh context.

---

## Flow D — PR review (`review_pull_request`)

Handler `review/handlers/review-pull-request.handler.ts` → `ReviewOrchestratorService.review()`
(`review/review-orchestrator.service.ts`).

```
getPullRequest ─┐
listFiles ──────┤
PrIntentService.collect() ──► intent (title/body/linked issues/commits)
upsertPullRequest()         (persist PR + intent)
KnowledgeRetriever.retrieve()  ──► profile + RAG chunks + changed-file contents
ReviewPromptBuilder.build()    ──► { system, prompt }
LlmService.completeJson<ReviewLlmOutput>()   ──► structured findings + token usage
ReviewResultMapper.map()       ──► inline comments (valid anchors) + summary body
GithubApiService.createReview()              ──► one GitHub Review (event: COMMENT)
prisma.review.create()         (persist Review + usage + githubReviewId)
```

Key technical points:
- **Guards.** Returns early if repository/installation disabled or suspended, if there are no
  changed files, or if no LLM API key is resolved (records a `failed` Review with the reason).
- **Intent.** `PrIntentService.collect()` (`review/pr-intent.service.ts`) regex-extracts issue
  references (`Closes #123`) from title+body, fetches those issues (`getIssue`) and commit
  messages — these are the "what is this PR for" signals the model reasons over.
- **Anchor validation.** `ReviewResultMapper.map()` (`review/review-result.mapper.ts`) keeps a
  finding as an *inline* comment only if its `path:line` exists in the diff — computed by
  `commentableLinesByFile()` (`review/diff.ts`, parses hunk headers for right-side lines).
  Off-diff findings are folded into the summary body so nothing is silently dropped.
- **Provider abstraction.** `LlmService.completeJson()` (`llm/llm.service.ts`) appends a
  "return JSON" instruction, calls the provider resolved by name via `LlmProviderRegistry`, and
  parses the result with `extractJson()` (`llm/json.ts`, tolerant of prose/code fences).

---

## Flow E — Conversational commands & statefulness

### Trigger (router)

`onIssueComment` / `onReviewComment` (`github/webhook-router.service.ts`) decide whether a
comment is bot-directed:

- `isSelf(login)` — ignore `onyx-the-reviewer[bot]` (**self-loop guard**, the cost valve).
- `isDirectedAtBot(body)` — starts with `/` or contains the `@mention` handle.
- `isReplyToBot(payload)` — for inline threads: if `in_reply_to_id` is set, one
  `getReviewCommentAuthor()` lookup confirms the parent is the bot → natural replies work without
  a mention.

If directed, `parseCommand(body, mentionHandle)` (`conversation/command-parser.ts`) yields
`{ command, focus?, target?, question? }` (`review` | `explain` | `summarize` | `ask`), and
`enqueueCommand()` enqueues a `pr_command` job keyed by `commandKey(commentId)`.

### Work (worker)

Handler `conversation/handlers/pr-command.handler.ts` → `ConversationOrchestratorService.handle()`
(`conversation/conversation-orchestrator.service.ts`):

- `command === 'review'` → delegates to `ReviewOrchestratorService.review()` (reuses Flow D,
  forcing a fresh review) + posts an ack.
- otherwise `answer()`:
  1. `getPullRequest` + `listPullRequestFiles`.
  2. `ensurePullRequest()` upserts the `PullRequest` row (threads hang off it).
  3. `ConversationService.resolveThread(pullRequestId, channel, anchorId)` — upserts the thread
     (`channel` = `issue`|`review`; `anchorId` = root review-comment id or `'pr'`).
  4. `appendMessage(thread, 'user', …)` — persist the incoming turn.
  5. `KnowledgeRetriever.retrieve()` for context; for `explain <file>` also `getFileContent`.
  6. `getHistory(thread)` — last 12 messages (oldest→newest).
  7. `ConversationPromptBuilder.build()` folds the **transcript** into the prompt (history is how
     statefulness reaches the model — the provider interface is single-prompt, so prior turns are
     rendered as text).
  8. `LlmService.complete()` (prose, not JSON).
  9. `reply()` — `replyToReviewComment()` for inline threads (keeps the thread), else
     `createIssueComment()`.
  10. `appendMessage(thread, 'assistant', …, replyId)` — persist the bot's turn.

### Cleanup (lifecycle)

`onPullRequestClosed()` (router) → `InstallationsService.deletePullRequest(repoId, number)` →
deletes the `PullRequest`, cascading away its reviews, threads, and messages (see SCHEMA cascade
chain). Verified live: closing a PR drops its `ConversationThread`/`ConversationMessage` rows to 0.

---

## Statefulness — where state lives

| State | Tables | Owner | Notes |
|---|---|---|---|
| Async work | `Job` | `JobWorker` | status machine `pending→running→completed/failed`, `attempts`, `runAt`, `lockedBy` |
| Webhook idempotency | `WebhookDelivery` | `IdempotencyService` | unique `deliveryId` drops redeliveries |
| Job idempotency | `Job.idempotencyKey` | `JobQueueService` | unique key → `enqueue` is a no-op on conflict |
| Repo knowledge | `Repository.indexStatus/indexedSha/profile`, `CodeChunk` | `RepoIndexerService` | pgvector embeddings + cached profile |
| Conversation memory | `ConversationThread`, `ConversationMessage` | `ConversationService` | per-PR/per-thread history fed back into prompts |
| Per-install config | `Installation.*Encrypted` | `InstallationsService` | AES-256-GCM secrets, env fallback |

## Idempotency & retry (cross-cutting)

- **Two idempotency layers:** webhook delivery id (drops GitHub redeliveries) and job
  idempotency key (drops duplicate enqueues, e.g. re-reviewing the same `headSha`).
- **Two retry layers:** in-process `retryWithBackoff()` around each outbound API call (transient
  `429/5xx`), and job-level retry with full-jitter backoff + dead-lettering for anything that
  escapes. Both use the same backoff math in `common/backoff.ts`.
