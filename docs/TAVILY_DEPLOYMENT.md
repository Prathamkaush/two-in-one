# Tavily discovery deployment and verification

Run shell commands on the VPS, not in Telegram. Keep existing bot tokens, chat IDs,
OpenAI settings and model prices. Never paste keys into chat or commit `.env`.

## Deploy

```bash
cd /var/www/two-in-one
git pull --ff-only
```

If Git reports local changes to `docker-compose.yml`, preserve your server-specific
port mapping and healthcheck before resolving the pull. This change does not modify
Compose: host port 3010 must still point to the application's internal listening port.

Add these settings to the existing server `.env` (only one definition of each key):

```dotenv
TAVILY_ENABLED=true
TAVILY_API_KEY=your-tavily-key
TAVILY_MAX_RESULTS_PER_QUERY=5
TAVILY_REQUEST_TIMEOUT_MS=15000
TAVILY_MAX_RETRIES=2
TAVILY_DAILY_CREDIT_LIMIT=30
TAVILY_MONTHLY_CREDIT_LIMIT=900
TAVILY_REQUESTS_PER_MINUTE=20
CLIENT_DISCOVERY_QUERIES=3
CLIENT_DISCOVERY_CANDIDATES=8
RESEARCH_TAVILY_QUERIES=1
RESEARCH_TAVILY_EXTRACTS=1
CLIENT_AGENT_ENABLED=false
```

The last setting keeps automatic client scheduling off during verification. Manual
admin runs still work. Research's existing schedule may stay enabled. Both agents
share the Tavily credit caps; heavy research use can leave fewer credits for client
discovery. These credit limits are independent of OpenAI's dollar limits.

```bash
docker compose build app migrate
docker compose run --rm migrate
docker compose up -d --force-recreate app
docker compose logs --tail=50 app
curl -sS http://127.0.0.1:3010/health/ready
```

Wait for application startup if the first health request is too early. The migration
adds `TavilyRequest` and a discovery summary field; it does not delete existing data.
If Compose overrides an environment variable under `app.environment`, that value
takes precedence over `.env`. Check only nonsecret settings when diagnosing this.

## Manual checks

Paste the following into the VPS Bash terminal. Type the admin API key at the prompt;
leave `ADMIN_KEY` as the variable name.

```bash
read -rsp "Admin API key: " ADMIN_KEY; echo
BASE=http://127.0.0.1:3010
api() { curl --fail-with-body -sS "$BASE/$1" -H "Authorization: Bearer $ADMIN_KEY" "${@:2}"; echo; }

# 1. One bounded paid Search request, cached for this UTC day.
api admin/tavily/test -X POST
api admin/tavily/status

# 2. Client discovery -> audit -> scoring -> drafts -> client Telegram notification.
api admin/client/run -X POST
api admin/queues
api admin/client/batches
api admin/client/leads
api admin/reports/daily
```

The run response means queued, not completed. Poll `admin/queues` and the batch list
until the batch is `COMPLETED`. The batch's `discovery` field gives queries, errors,
duplicates and uncertain website counts. Lead records contain sources, evidence,
scores and drafts. Telegram receives qualified leads or an honest empty report.
`/client_today` in Telegram displays the stored daily report. There is one batch per
local day: repeated `/admin/client/run` calls reuse it and do not send additional
leads or restart a completed day's discovery.

Create a Tavily research source **once**; existing RSS/operator sources remain:

```bash
api admin/research/sources
api admin/research/sources -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Tavily market problems","adapter":"tavily","configuration":{"topics":["small businesses India","local service businesses","retail operations"],"lenses":["customer complaints","manual processes spreadsheets","software too expensive","technology adoption challenges"]}}'

# Inspect existing cycles. Start one ONLY if none is active/analyzing.
api admin/research/cycles
# api admin/research/cycles -X POST

# 3. Queue one collection batch for enabled RSS and Tavily sources.
api admin/research/collect -X POST
api admin/queues
api admin/tavily/status

# 4. After processing has finished, generate the operational report.
api admin/research/summary -X POST
api admin/reports/daily
unset ADMIN_KEY
```

`GET /admin/research/cycles/<cycle-id>/items` returns stored evidence, provenance and
processing status. `/research_status` in Telegram shows cycle progress. Research
collection is idempotent within the configured interval. A failed source job does
not block jobs for other sources. Partial failures and retries appear in the Tavily
ledger/status; exhausted jobs also appear in protected run logs and alerts.

If Telegram is silent, inspect `Notification.sentAt` and delivery jobs as before:
queueing a notification does not prove delivery. The existing
`POST /admin/telegram/test` with `{"agent":"CLIENT"}` or `{"agent":"RESEARCH"}`
remains available.

After reviewing real source evidence and receiving the client report, set
`CLIENT_AGENT_ENABLED=true`, then recreate `app`. It runs at `CLIENT_AGENT_TIME`
in `TIMEZONE`; changing the flag does not immediately start a run.

## Qualification and cost limits

- Search uses basic depth, no generated answer, and bounded results. Client queries
  rotate region/category combinations by date; research rotates configured
  topics/lenses by batch slot.
- Client discovery reuses the small-model structured extraction and existing
  OpenAI reservation ledger. It checks exact quoted evidence and observed URLs.
  Verification searches are capped by `CLIENT_DISCOVERY_CANDIDATES`; already-known
  identities are skipped before verification.
- Missing website evidence remains `UNKNOWN`. `NO_WEBSITE` requires an explicit
  first-party statement and no verified contradictory website. Current activity
  requires a recent date present in the quoted evidence. Sparse snippets often mean
  fewer or zero qualified leads. Nothing is invented to reach the daily limit.
- Existing website audit records `REACHABLE`/`UNREACHABLE`; a failed HTTP request or
  missing viewport does not establish a weak website. V1 automated qualification
  prioritizes confirmed no-website opportunities. Evidence-backed weak-website
  candidates can still use the existing operator intake.
- A short relevant research snippet may trigger Extract; sufficient snippets do
  not. Extract failure falls back to the snippet with an explicit metadata flag.
  Known URLs and repeated batch results are skipped before Extract, and existing
  URL/content deduplication still runs before AI processing.
- Every HTTP attempt reserves one credit before sending. Failed/ambiguous attempts
  retain that reservation conservatively. Reported usage is also stored. Caps reset
  at UTC day/month and include both agents. Credits are not a dollar-price estimate.
  A successful request is reused on queue retry; retry counts survive restarts.
- Long provider `Retry-After` responses are deferred, not bypassed. Inspect failed
  jobs and the usage ledger before using the existing protected queue retry endpoint.
  An unresolved reservation is never automatically sent again.

Tavily API references: [Search](https://docs.tavily.com/documentation/api-reference/endpoint/search),
[Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract),
[credits](https://docs.tavily.com/documentation/api-credits).

## Automated and short-cycle testing

```bash
npm ci
npm run prisma:generate
npm run verify
npm run test:integration
```

Integration testing requires local PostgreSQL/Redis and database-create permission.
The runner creates and removes its own randomly named test database. Tavily, OpenAI
and Telegram are mocked in agent tests; no paid API keys are required.

For a separate development deployment, use `NODE_ENV=development` and
`RESEARCH_CYCLE_DAYS=1`. After collecting and processing evidence, call
`POST /admin/research/cycles/<cycle-id>/finalize` with `{"simulate":true}` to close
early and queue final synthesis. Never change the production deployment to
development for this test. Production rejects simulation and still waits until the
cycle ends. Daily reports contain operations only, not business opportunities.
