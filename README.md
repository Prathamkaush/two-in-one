# Dual Automation Platform

One NestJS application, PostgreSQL/Prisma, Redis/BullMQ, and shared OpenAI/Telegram/Tavily services. Tavily supplies live client discovery and a separate market-evidence research adapter. External integrations default to disabled. No Instagram login, browser automation, or automatic outreach exists. See [Tavily deployment and manual verification](docs/TAVILY_DEPLOYMENT.md).

## Current status and server deployment

The MVP supports qualified leads and a separate manual-review list, targeted Tavily verification, and a bounded same-day refresh of an empty client batch. Automated validation passed 119 unit tests, 12 PostgreSQL/Redis integration tests, TypeScript, lint, and build. External API calls were mocked: these results do not guarantee real Tavily coverage or Telegram delivery on the server.

Run deployment commands in the VPS terminal, not in Telegram:

```bash
cd /var/www/two-in-one
git pull --ff-only
```

Before rebuilding, update the existing server `.env` using the Tavily settings in [.env.example](.env.example). Set `TAVILY_ENABLED=true` and `TAVILY_API_KEY` to your key, configure the credit limits, and keep `CLIENT_AGENT_ENABLED=false` until the manual checks pass. Preserve existing OpenAI pricing, Telegram credentials, database settings, and server-specific port configuration. Each environment key should have only one definition; Compose `environment` values override `env_file` values.

```bash
docker compose build app migrate
docker compose run --rm migrate
docker compose up -d --force-recreate app
docker compose logs --tail=50 app
curl -sS http://127.0.0.1:3010/health/ready
```

The health command assumes the existing VPS host port `3010`; the repository's local default is `3000`. Allow startup to finish before checking readiness. If Git reports local Compose changes, preserve the VPS port mapping and healthcheck while resolving them.

Complete these checks before enabling unattended client runs. All `/admin/*` endpoints require the admin Bearer token; the [deployment guide](docs/TAVILY_DEPLOYMENT.md#manual-checks) includes copyable commands that prompt for it.

| Check | Endpoint/action | Evidence of success |
| --- | --- | --- |
| Tavily connectivity | `POST /admin/tavily/test` | Successful response; inspect `GET /admin/tavily/status` for usage/errors |
| Client pipeline | `POST /admin/client/run` | Batch reaches `COMPLETED` in `GET /admin/client/batches`; inspect evidence and drafts in `GET /admin/client/leads` |
| Same-day discovery preview | `POST /admin/client/discovery-preview` | Inspect candidates and rejection reasons even after today's batch completed; cached requests are reused, new requests use API budgets; no leads or Telegram messages are created |
| Empty-batch refresh | `POST /admin/client/run` with `{"refresh":true}` | One refresh of an empty completed batch; revision increases to 1, original discovery summary is retained, and existing deliveries cannot be reset |
| Research source | `POST /admin/research/sources` with `adapter: "tavily"` | Source appears in `GET /admin/research/sources`; existing RSS sources remain |
| Research collection | Inspect `GET /admin/research/cycles`, start a cycle only if none is active, then `POST /admin/research/collect` | Items appear in `GET /admin/research/cycles/<cycle-id>/items` and finish processing |
| Reports and delivery | `POST /admin/research/summary`; inspect `GET /admin/reports/daily` | Actual messages arrive through the appropriate Telegram bot |

A returned job or notification ID means queued, not finished or delivered. Inspect `GET /admin/queues` for failures. Client runs reuse one batch per local day; only the explicit, once-per-day empty-batch refresh restarts completed discovery. Research collection reuses the current configured batch interval. This update adds manual-review statuses and batch revision fields: run the migration before starting the rebuilt app.

Once live evidence and Telegram delivery are verified, set `CLIENT_AGENT_ENABLED=true` and, if desired, `RESEARCH_AGENT_ENABLED=true`, then recreate `app`. Scheduling follows the configured times and timezone; enabling a flag does not immediately trigger work. Tavily being enabled alone does not create a research source or start a research cycle.

### MVP boundaries and later phases

- Automated client qualification prioritizes explicit, evidence-backed **no-website** opportunities. Missing search results remain `UNKNOWN`. A day can produce fewer than six leads or none; quality thresholds are not lowered to fill the quota.
- With `CLIENT_REVIEW_ENABLED=true` (default), unused places can contain identity-backed **MANUAL REVIEW - NOT QUALIFIED** candidates with unknown website/activity status. Qualified leads and reviews share the daily limit; both are deduplicated across days. Review drafts are neutral templates for use only after your verification. `selectedCount` and `reviewCount` are reported separately.
- Automated weak/outdated-website detection is a later enhancement. Existing HTTP checks do not establish website quality; operator-verified weak-website candidates remain supported.
- Research sends operational summaries during the cycle. Business opportunities are generated only after cycle closure, with fewer results when evidence is insufficient.
- Deeper competitor research, semantic clustering, additional sources, a dashboard, and cross-cycle comparison are later enhancements, not prerequisites for running this MVP.

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
| Client MVP | Tavily discovery, verified candidate intake, public HTTPS checks, configurable scoring, daily top selection, saved drafts, Telegram delivery, manual status updates | `src/client-agent`, `src/tavily`, `src/scheduler` |
| Research MVP | Tavily/RSS/operator adapters, independent collection jobs, provenance, normalization, URL/content deduplication, quoted signal extraction, exact problem clustering, operational summaries | `src/research-agent`, `src/tavily`, `src/scheduler` |
| Monthly MVP | Cycle closure guard, bounded evidence synthesis, reference validation, candidate/final-opportunity persistence, authenticated report retrieval, insufficiency reporting | `src/research-agent/research.service.ts`, `opportunity.schema.ts` |
| Expansion | Pending: additional licensed/API sources, semantic clustering, deeper competitor research, PageSpeed/Lighthouse, dashboard, cross-cycle comparison | Provider interfaces already exist |

## Client market and configuration

Defaults target Delhi, Gurugram, Noida, Faridabad, and Ghaziabad. Categories match the requested salons, fitness, food, photography, events, interiors, coaching, boutiques, bakeries, yoga, home services, and small agencies list.

`CLIENT_REGIONS` and `CLIENT_CATEGORIES` are comma-separated defaults. `GET/PUT /admin/client/configuration` provides a database override with `regions`, `categories`, `dailyLimit`, `weights`, and `minimumScore`. Scoring is versioned through a weights snapshot on each analysis. No-website evidence has the largest default weight. Lack of a supplied URL alone is **not** treated as proof of no website.

When `TAVILY_ENABLED=true`, `BusinessDiscoverySource` searches rotating region/category combinations before the existing daily pipeline runs. Website verification, quoted evidence checks and identity deduplication precede qualification. Without Tavily, operator-verified intake continues to work. Configure and test the provider before enabling unattended discovery; missing website evidence remains unknown.

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

Replace every illustrative value with verified evidence; these are not real leads. Region/category names must match the configuration. Evidence older than 30 days does not qualify. Identity deduplication uses normalized profiles, business name/location and website domains. `instagramUrl` may be null when `socialUrls` contains another verified public social profile. Intake does not overwrite an existing lead or its contact history.

`POST /admin/client/run` starts the queue chain: discovery pool → website checks → scoring → top six → AI drafts → Telegram outbox. OpenAI must be configured for draft generation. Up to 100 candidates are examined; only those meeting thresholds are selected. A day may produce fewer than six. Unselected qualified candidates remain eligible the next day, while presented leads are excluded. `GET /admin/client/leads` returns recent records and drafts. `PATCH /admin/client/leads/:id` accepts `status` and/or `notes` for manual follow-up.

Website checks use HTTPS only, pin public DNS addresses, reject private/reserved addresses, bound response size/time, and do not follow redirects. HTTP availability, response time, and a viewport hint are observations; they are not a full quality, performance, or mobile audit. No claims of a broken/poor site are inferred solely from a failed request.

## Research operations

1. Create permitted sources using `POST /admin/research/sources` with `{ "name": "My permitted feed", "adapter": "rss", "url": "https://..." }`. Use `adapter: "operator"` without a URL for verified imports. No feeds are enabled by default.
2. Start a cycle with `POST /admin/research/cycles`. Only one active/analyzing cycle is allowed. Historical cycles are preserved.
3. Trigger RSS/Tavily batches with `POST /admin/research/collect`, or import a record with `POST /admin/research/cycles/:cycleId/items/:sourceId` using `sourceUrl`, `title`, `content`, and optional ISO `publishedAt`. Tavily sources use `adapter: "tavily"` with optional `configuration: { topics: [...], lenses: [...] }`.
4. Inspect cycles at `GET /admin/research/cycles`. Trigger an operational report with `POST /admin/research/summary`.
5. Finalize an elapsed cycle with `POST /admin/research/cycles/:id/finalize` and `{}`. Pending extraction prevents finalization. The finalization job performs monthly synthesis and saves the report.
6. Retrieve the complete JSON report with `GET /admin/research/reports/:id`. Telegram includes the authenticated API path; a public dashboard/report link is not yet provided.

Default schedule is 13:00–17:00 Asia/Kolkata, batches every 30 minutes, summary at 17:00. Cron only enqueues short jobs; there is no four-hour sleeping process. Missed collection slots during downtime are not backfilled. Expired cycles are checked each minute when research scheduling is enabled. Start subsequent cycles explicitly.

Daily summaries contain item/source counts, processing state, and platform AI cost for the UTC accounting day. They never call the opportunity synthesis method. Signal quotes must occur verbatim in collected content. V1 clustering groups normalized exact category/problem strings; semantic clustering remains future work.

Monthly synthesis receives at most 60 items and a bounded 36 KB evidence representation. It needs at least three processed records spanning two domains to run. Each retained opportunity must reference at least two supplied records, with scores in [0,1]. Unknown demand, competitors, and willingness to pay must remain uncertain. Fewer than ten results produces an explicit insufficiency reason. This is a bounded V1 synthesis, not exhaustive market or competitor validation.

## External credentials and spending

Start with `.env.example`. Required foundation values: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `ADMIN_API_KEY`, `TIMEZONE`. Compose also requires `POSTGRES_PASSWORD`. For deployment, replace the local database password and keep its URL representation correctly encoded.

For Tavily set `TAVILY_ENABLED=true` and `TAVILY_API_KEY`. Search results, request timeouts, retries, searches per batch, candidate verification, and research Extract calls are bounded by the settings in `.env.example`. Both agents share `TAVILY_DAILY_CREDIT_LIMIT` and `TAVILY_MONTHLY_CREDIT_LIMIT`, independently of OpenAI's dollar budgets. Each HTTP attempt reserves credits before sending; failed or ambiguous attempts retain conservative reservations, and successful responses are cached for retries. `GET /admin/tavily/status` reports recent activity without exposing the key. See the [deployment guide](docs/TAVILY_DEPLOYMENT.md#qualification-and-cost-limits) for accounting details.

Client website verification includes the observed social handle, category and locality. `CLIENT_ENRICHMENT_EXTRACTS=2` limits selective profile extraction. Failed verification leaves uncertainty explicit and can fall back to manual review; it never establishes website absence. Check `enrichmentFailures` alongside discovery errors. Set `CLIENT_REVIEW_ENABLED=false` to deliver qualified leads only.

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

Integration tests require local PostgreSQL/Redis and permission to create a temporary database. The runner creates and migrates a uniquely named test database, runs tests, then removes only that test database. Tavily, OpenAI, and Telegram calls are mocked. The tests drive both agent workflows through persistence/reporting without waiting for schedules or 30 days, including Tavily credit concurrency and durable response reuse. `npm.cmd run verify` runs type checking, lint, unit tests, and build together; integration tests run separately.

For interactive development use `RESEARCH_CYCLE_DAYS=1`. A nonproduction instance also accepts `{ "simulate": true }` on finalization to close the cycle now after processing completes. Docker runs with `NODE_ENV=production`, where this shortcut is rejected. No simulation bypass exists for pending evidence.

Queue retries use exponential backoff, bounded attempts/concurrency, and stable IDs. Completed jobs are retained; database run records and individual domain operations additionally guard replay. `GET /admin/queues` shows queue counts. `POST /admin/queues/:queue/jobs/:id/retry` retries an exhausted job after its underlying issue is fixed. Reprocessing API: `POST /admin/research/items/:id/process`. Jobs with ambiguous AI billing require ledger reconciliation first.

V1 retains completed queue records; add an archive/retention policy before high-volume use. A database run log does not make arbitrary external side effects exactly once. Use one application instance initially. Public HTTP access is restricted, but feed permission and business evidence accuracy remain operator responsibilities.

## Next operational step

Deploy the Tavily integration, configure the server key and research source, and complete the manual checks above. Then enable the schedules. Follow [TAVILY_DEPLOYMENT.md](docs/TAVILY_DEPLOYMENT.md) for the full deployment, live verification, and short development-cycle procedure.
