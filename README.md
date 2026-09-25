# Dual Automation Platform

One NestJS application, PostgreSQL/Prisma, Redis/BullMQ, and shared OpenAI/Telegram services. This is a working core MVP, with live lead discovery still pending a permitted provider. External integrations are disabled in the generated local configuration. No Instagram login, browser automation, or automatic outreach exists.

## Start locally

Requires Node 22+ and Docker Desktop with its Linux engine running. On Windows use `npm.cmd`/`npx.cmd` if PowerShell blocks npm scripts.

```powershell
npm.cmd ci
node scripts/setup-env.cjs
docker compose up -d --build
node scripts/smoke.cjs
```

The setup script creates `.env` with a random administrator key and leaves existing configuration intact. Local ports: app `3000`, PostgreSQL `55432`, Redis `56379`, bound to loopback. Database/Redis data use named volumes. Compose runs versioned migrations before the app starts. The app runs as an unprivileged user and in production mode inside Docker.

Health: `http://localhost:3000/health/ready`. This is a backend API, not a dashboard. All `/admin/*` routes require `Authorization: Bearer <ADMIN_API_KEY>` from your local `.env`. Do not put that key in URLs.

For development with source watching:

```powershell
docker compose up -d postgres redis
docker compose stop app
npm.cmd run prisma:generate
npm.cmd run db:migrate
npm.cmd run dev
```

## Implementation phases

| Phase | Implemented | Main files |
| --- | --- | --- |
| Foundation | Validated configuration, normalized schema, migrations, queues, health, authentication, sanitized logging, structured AI, reserved-cost accounting, notification outbox, Docker | `src/common`, `src/database`, `src/queues`, `src/ai`, `src/usage`, `src/telegram`, `prisma`, `Dockerfile`, `docker-compose.yml` |
| Client MVP | Verified candidate intake, public HTTPS checks, configurable scoring, daily top selection, saved drafts, Telegram delivery, manual status updates | `src/client-agent`, `src/scheduler` |
| Research MVP | RSS/operator adapters, independent collection jobs, provenance, normalization, URL/content deduplication, quoted signal extraction, exact problem clustering, operational summaries | `src/research-agent`, `src/scheduler` |
| Monthly MVP | Cycle closure guard, bounded evidence synthesis, reference validation, candidate/final-opportunity persistence, authenticated report retrieval, insufficiency reporting | `src/research-agent/research.service.ts`, `opportunity.schema.ts` |
| Expansion | Pending: live business discovery, additional licensed/API sources, semantic clustering, deeper competitor research, PageSpeed/Lighthouse, dashboard, cross-cycle comparison | Provider interfaces already exist |

## Client market and configuration

Defaults target Delhi, Gurugram, Noida, Faridabad, and Ghaziabad. Categories match the requested salons, fitness, food, photography, events, interiors, coaching, boutiques, bakeries, yoga, home services, and small agencies list.

`CLIENT_REGIONS` and `CLIENT_CATEGORIES` are comma-separated defaults. `GET/PUT /admin/client/configuration` provides a database override with `regions`, `categories`, `dailyLimit`, `weights`, and `minimumScore`. Scoring is versioned through a weights snapshot on each analysis. No-website evidence has the largest default weight. Lack of a supplied URL alone is **not** treated as proof of no website.

The initial source is **operator-verified intake**, not autonomous discovery. `BusinessDiscoverySource` is the integration seam for a future permitted data/search provider. The daily job currently researches the existing verified candidate pool. Select a provider with appropriate data rights and coverage before enabling unattended lead discovery.

`POST /admin/client/candidates` accepts:

```json
{
  "businessName": "Actual verified business name",
  "category": "Bakeries",
  "location": "Delhi",
  "websiteUrl": null,
  "instagramUrl": "https://www.instagram.com/actual_business/",
  "sourceUrl": "https://actual-public-source.example/business",
  "verifiedAt": "2026-09-24T08:00:00.000Z",
  "facts": [{ "claim": "An observation you verified", "sourceUrl": "https://actual-public-source.example/business" }],
  "factors": {
    "noWebsite": true, "poorWebsite": false, "activeSocial": true,
    "clearOffering": true, "recentActivity": true, "operatingEvidence": true,
    "weakContact": false, "serviceFit": true
  }
}
```

Replace every illustrative value with verified evidence; these are not real leads. Region/category names must match the configuration. Evidence older than 30 days does not qualify. Identity deduplication uses the Instagram profile. Intake does not overwrite an existing lead or its contact history.

`POST /admin/client/run` starts the queue chain: discovery pool → website checks → scoring → top six → AI drafts → Telegram outbox. OpenAI must be configured for draft generation. Up to 100 candidates are examined; only those meeting thresholds are selected. A day may produce fewer than six. Unselected qualified candidates remain eligible the next day, while presented leads are excluded. `GET /admin/client/leads` returns recent records and drafts. `PATCH /admin/client/leads/:id` accepts `status` and/or `notes` for manual follow-up.

Website checks use HTTPS only, pin public DNS addresses, reject private/reserved addresses, bound response size/time, and do not follow redirects. HTTP availability, response time, and a viewport hint are observations; they are not a full quality, performance, or mobile audit. No claims of a broken/poor site are inferred solely from a failed request.

## Research operations

1. Create permitted sources using `POST /admin/research/sources` with `{ "name": "My permitted feed", "adapter": "rss", "url": "https://..." }`. Use `adapter: "operator"` without a URL for verified imports. No feeds are enabled by default.
2. Start a cycle with `POST /admin/research/cycles`. Only one active/analyzing cycle is allowed. Historical cycles are preserved.
3. Trigger RSS batches with `POST /admin/research/collect`, or import a record with `POST /admin/research/cycles/:cycleId/items/:sourceId` using `sourceUrl`, `title`, `content`, and optional ISO `publishedAt`.
4. Inspect cycles at `GET /admin/research/cycles`. Trigger an operational report with `POST /admin/research/summary`.
5. Finalize an elapsed cycle with `POST /admin/research/cycles/:id/finalize` and `{}`. Pending extraction prevents finalization. The finalization job performs monthly synthesis and saves the report.
6. Retrieve the complete JSON report with `GET /admin/research/reports/:id`. Telegram includes the authenticated API path; a public dashboard/report link is not yet provided.

Default schedule is 13:00–17:00 Asia/Kolkata, batches every 30 minutes, summary at 17:00. Cron only enqueues short jobs; there is no four-hour sleeping process. Missed collection slots during downtime are not backfilled. Expired cycles are checked each minute when research scheduling is enabled. Start subsequent cycles explicitly.

Daily summaries contain item/source counts, processing state, and platform AI cost for the UTC accounting day. They never call the opportunity synthesis method. Signal quotes must occur verbatim in collected content. V1 clustering groups normalized exact category/problem strings; semantic clustering remains future work.

Monthly synthesis receives at most 60 items and a bounded 36 KB evidence representation. It needs at least three processed records spanning two domains to run. Each retained opportunity must reference at least two supplied records, with scores in [0,1]. Unknown demand, competitors, and willingness to pay must remain uncertain. Fewer than ten results produces an explicit insufficiency reason. This is a bounded V1 synthesis, not exhaustive market or competitor validation.

## External credentials and spending

Start with `.env.example`. Required foundation values: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `ADMIN_API_KEY`, `TIMEZONE`. Compose also requires `POSTGRES_PASSWORD`. For deployment, replace the local database password and keep its URL representation correctly encoded.

For OpenAI set `OPENAI_ENABLED=true`, `OPENAI_API_KEY`, `OPENAI_MODEL_SMALL`, `OPENAI_MODEL_STRONG`, and `OPENAI_MODEL_PRICES`. Prices are explicit USD per million tokens, for example the **shape only**: `{"your-model":{"input":1,"output":4}}`. Choose current supported models and supply their actual rates; this example is not a pricing claim. Configure daily/monthly limits and output limits. Final synthesis has a separate 12,000-token default cap.

AI calls use the SDK Responses API with Zod structured outputs, following the [official structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs). The service disables SDK retries, treats evidence as untrusted, provides no executable tools, and requests no remote URL fetches from the model. Structured output is not a factual guarantee: review all outreach and opportunities.

PostgreSQL advisory locks serialize cost reservations across workers. Conservative input/output estimates reserve budget before calls. Actual token usage settles the reservation. Warnings fire at 80%, critical notices at 95%, and work is blocked if it would exceed either budget. Optional work can stop at 95%. Both agents currently use optional AI jobs. Accounting periods are UTC; research scheduling uses the configured timezone.

Successful structured results are cached in the usage ledger for retry recovery. Ambiguous failures retain their full reservations as `UNCERTAIN`; they cannot automatically make another charged request under the same key. Reserved/uncertain entries need explicit operator investigation against provider usage before manual reconciliation. Estimates depend on correct configured pricing and are not a provider-enforced credit cap.

For separate Telegram bots, set `CLIENT_TELEGRAM_BOT_TOKEN` and `RESEARCH_TELEGRAM_BOT_TOKEN`. Set the numeric operator `TELEGRAM_CHAT_ID` for both, or override with `CLIENT_TELEGRAM_CHAT_ID` and `RESEARCH_TELEGRAM_CHAT_ID`. Then set `TELEGRAM_ENABLED=true`. Client notifications use the client bot; research notifications use the research bot; shared budget alerts go to both. Start a chat with each bot before delivery. Existing single-bot configuration using `TELEGRAM_BOT_TOKEN` remains supported when neither agent token is configured.

`POST /admin/telegram/test` accepts `{ "agent": "CLIENT" }` or `{ "agent": "RESEARCH" }`; an empty body tests both in split mode. Notifications persist their target agent in PostgreSQL, including retry routing. Migration assigns existing agent report notifications to their appropriate bot. Legacy system notifications use the client bot when delivered after switching to split mode.

Optional inbound commands use `POST /telegram/webhook/client` and `POST /telegram/webhook/research` in split mode. Set distinct 32+ character `CLIENT_TELEGRAM_WEBHOOK_SECRET` and `RESEARCH_TELEGRAM_WEBHOOK_SECRET` values, and register each bot's corresponding public HTTPS webhook with its secret. Replies use the receiving bot; update IDs are isolated between bots. The original `/telegram/webhook` and `TELEGRAM_WEBHOOK_SECRET` apply only in single-bot mode. No webhook is registered automatically. Every endpoint validates its secret and operator chat. Commands: `/status`, `/health`, `/client`, `/client_today`, `/research`, `/research_today`, `/research_status`, `/cost`.

Telegram delivery is at least once: a process crash after Telegram accepts a message but before the database records success can cause a duplicate. Failed delivery never recursively sends another Telegram alert. Inspect `SystemError` and failed queues when the notification channel itself is unavailable.

## Tests and recovery

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run test:integration
npm.cmd run build
node scripts/smoke.cjs
```

Integration tests require local PostgreSQL/Redis and permission to create a temporary database. The runner creates and migrates a uniquely named test database, runs tests, then removes only that test database. Paid AI and Telegram calls are mocked. The tests drive both agent workflows through persistence/reporting without waiting for schedules or 30 days.

For interactive development use `RESEARCH_CYCLE_DAYS=1`. A nonproduction instance also accepts `{ "simulate": true }` on finalization to close the cycle now after processing completes. Docker runs with `NODE_ENV=production`, where this shortcut is rejected. No simulation bypass exists for pending evidence.

Queue retries use exponential backoff, bounded attempts/concurrency, and stable IDs. Completed jobs are retained; database run records and individual domain operations additionally guard replay. `GET /admin/queues` shows queue counts. `POST /admin/queues/:queue/jobs/:id/retry` retries an exhausted job after its underlying issue is fixed. Reprocessing API: `POST /admin/research/items/:id/process`. Jobs with ambiguous AI billing require ledger reconciliation first.

V1 retains completed queue records; add an archive/retention policy before high-volume use. A database run log does not make arbitrary external side effects exactly once. Use one application instance initially. Public HTTP access is restricted, but feed permission and business evidence accuracy remain operator responsibilities.

## Next integration step

Select and connect a permitted business discovery/search provider for Delhi NCR, configure real RSS sources, and add OpenAI/Telegram credentials. Validate a small real-data run before enabling `CLIENT_AGENT_ENABLED` and `RESEARCH_AGENT_ENABLED`. Deeper source coverage and semantic analysis are subsequent phases, not simulated features in this build.
