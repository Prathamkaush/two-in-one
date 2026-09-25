# Dual Automation Platform

Build a production-oriented automation platform containing two independent automation agents that share the same NestJS backend, PostgreSQL database, Redis instance, Telegram integration, and deployment infrastructure.

## 1. Core Technology Stack

Use:

* Node.js
* TypeScript
* NestJS
* PostgreSQL
* Prisma ORM
* Redis
* BullMQ
* `@nestjs/schedule`
* OpenAI Node SDK
* Telegram Bot API
* Axios/fetch for HTTP requests
* Docker
* Docker Compose

Do NOT introduce Kafka, Kubernetes, microservices, or Python for V1.

The architecture should remain modular enough that workers can later be moved to separate processes or servers.

---

# 2. System Architecture

One NestJS application should contain two independent automation modules:

```text
                    NestJS Application
                           │
              ┌────────────┴────────────┐
              │                         │
       Client Lead Agent         Research Agent
              │                         │
              └────────────┬────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
          PostgreSQL      Redis      Telegram
                           │
                         BullMQ
                           │
                        OpenAI
```

Both agents must have separate queues, schedules, configuration, logging, database entities, and failure handling.

Shared infrastructure/services should include:

* OpenAI service
* Telegram service
* scheduling
* Redis
* BullMQ
* Prisma
* logging
* configuration
* cost/token tracking

---

# 3. BOT #1 — Client Lead Discovery Agent

## Objective

Automatically research businesses that could potentially need web-development services.

The system should prioritize businesses that:

* have an active online/social presence;
* appear to be legitimate operating businesses;
* have no dedicated website;
* have a poor/outdated website;
* have weak web presence;
* rely primarily on Instagram/social media;
* have clear products/services;
* appear suitable for website-development outreach.

Do NOT automatically send Instagram DMs.

The user will manually send all initial Instagram messages.

## Daily workflow

Run Bot #1 once per day.

Pipeline:

```text
Discover businesses
        ↓
Collect public business information
        ↓
Detect website
        ↓
Analyze website if present
        ↓
Analyze online presence
        ↓
Filter irrelevant businesses
        ↓
Calculate lead score
        ↓
Select best 5–6 businesses
        ↓
Generate personalized outreach message
        ↓
Store results
        ↓
Send results to Telegram
```

The system can research substantially more businesses internally but should only present approximately 5–6 high-quality leads per day.

Quality is more important than volume.

## Lead information

Store at minimum:

```text
Business name
Category
Location
Website URL
Instagram URL/username if discovered
Other public social URLs
Public business contact information if available
Website status
Website quality information
Online presence information
Reason business was selected
Lead score
Suggested personalized message
Discovery date
Contact status
Notes
```

Possible statuses:

```text
DISCOVERED
ANALYZED
QUALIFIED
PRESENTED
CONTACTED
REPLIED
INTERESTED
NEGOTIATING
WON
LOST
REJECTED
```

## Website analysis

If no website exists, mark:

```text
NO_WEBSITE
```

If a website exists, perform lightweight analysis where possible:

* HTTPS
* responsiveness/mobile usability
* performance
* obvious technical problems
* contact/enquiry functionality
* general website freshness indicators
* PageSpeed/Lighthouse data when available

Do not make unsupported claims about a business.

## Lead scoring

Implement scoring as configurable logic.

Example factors:

```text
No website
Poor website
Active social presence
Clear business offering
Recent activity
Strong evidence business is operating
Weak conversion/contact experience
Good fit for web-development services
```

Do NOT hardcode the scoring permanently. Store weights/configuration so they can be changed later.

## Outreach generation

OpenAI should generate a short personalized DM based only on verified information collected about the business.

Messages should:

* mention the business naturally;
* identify a real web-presence opportunity;
* be short;
* avoid spam language;
* avoid invented claims;
* avoid aggressive sales language;
* optionally mention relevant portfolio work.

The AI must never fabricate information to make the message more personalized.

## Instagram

V1 DOES NOT automatically send Instagram DMs.

Do not implement browser automation that logs into Instagram.

Do not implement automatic cold messaging.

Telegram should provide the Instagram URL/username and suggested message.

The user manually opens Instagram and sends the message.

---

# 4. BOT #1 Telegram Output

Example:

```text
CLIENT AGENT

Date: 24 September 2026

Lead 1/6

Business:
ABC Fitness Studio

Category:
Gym

Website:
Not found

Instagram:
@abcfitness

Lead Score:
86/100

Why selected:
Active online presence but no dedicated website was found.

Suggested message:
[personalized message]

Status:
Ready for manual outreach
```

Include enough information for the user to inspect the business before sending anything.

---

# 5. BOT #2 — Long-Term Business Opportunity Research Agent

## Objective

Conduct continuous market/problem/opportunity research for approximately 30 days.

IMPORTANT:

Bot #2 MUST NOT generate daily business ideas.

Bot #2 MUST NOT provide daily opportunity rankings.

Bot #2 MUST NOT recommend businesses to build during the research period.

Its job during the 30-day cycle is to collect, normalize, deduplicate, classify, and store research.

Only after the research cycle finishes should it generate the final business opportunities.

---

# 6. Bot #2 Research Sources

Design a source-adapter architecture.

Potential sources include:

* Reddit
* Quora
* Google Trends
* technology communities
* product/startup websites
* news sources
* industry websites
* public forums
* customer complaints/reviews where legitimately accessible
* other permitted public sources

Do not assume every website can be scraped.

Prefer:

1. official APIs;
2. RSS feeds;
3. legitimate search/data APIs;
4. permitted public HTTP access.

Each source must have its own adapter so sources can easily be added or removed.

Example:

```text
ResearchSource interface

RedditSource
NewsSource
TrendsSource
ProductSource
ForumSource
...
```

A failure in one source must NOT stop the entire research cycle.

---

# 7. Daily Bot #2 Operation

Default research window:

```text
1:00 PM – 5:00 PM
```

Timezone must be configurable.

Do NOT create one process that sleeps/runs continuously for four hours.

Use scheduled BullMQ jobs throughout the research window.

For example:

```text
1:00 research batch
1:30 research batch
2:00 research batch
...
4:30 research batch
5:00 daily summary
```

Exact frequency must be configurable.

Each research item should retain provenance.

Store:

```text
Source
Source URL/reference
Collection timestamp
Publication timestamp when available
Title
Relevant extracted content/summary
Topic/category
Extracted problems/signals
Metadata
Processing status
Duplicate information
Confidence
```

Raw/source evidence should remain traceable to later conclusions.

---

# 8. Research Processing

Pipeline:

```text
Raw research
      ↓
Normalize
      ↓
Remove obvious irrelevant content
      ↓
Deduplicate
      ↓
AI structured extraction
      ↓
Identify useful market/problem signals
      ↓
Categorize
      ↓
Cluster related evidence
      ↓
Persist
```

OpenAI should primarily perform structured extraction/classification.

Avoid repeatedly sending the entire historical research database to the model.

Use compact structured representations.

Consider embeddings for semantic similarity/deduplication where beneficial.

---

# 9. Bot #2 Daily Telegram Report

The daily message is ONLY an operational/research report.

Example:

```text
RESEARCH AGENT

Date: 24 September 2026

Status:
Completed successfully

Started:
1:00 PM

Finished:
4:52 PM

Sources researched:
Reddit — 41 items
Quora — 18 items
News — 27 items
Other — 14 items

Total items examined:
100

Data successfully stored:
Yes

Research cycle:
Day 4 of 30

API/OpenAI cost today:
$0.XX

Next research:
25 September 2026
```

DO NOT include:

* business ideas;
* opportunity recommendations;
* opportunity scores;
* daily rankings;
* "you should build X";
* premature conclusions.

Daily reports exist only so the operator can verify that the research agent is functioning correctly.

---

# 10. 30-Day Research Cycle

Create a `ResearchCycle` entity.

Example:

```text
id
startDate
endDate
status
currentDay
totalItemsCollected
totalItemsProcessed
totalCost
createdAt
completedAt
```

Possible states:

```text
PENDING
ACTIVE
ANALYZING
COMPLETED
FAILED
```

All collected research must belong to a research cycle.

Do NOT delete historical research when a new cycle begins.

Historical information may later be used to detect persistent versus temporary market signals.

---

# 11. End-of-Cycle Analysis

At the end of the configured research cycle:

```text
30-day dataset
      ↓
Final cleaning
      ↓
Deduplication
      ↓
Problem clustering
      ↓
Pattern detection
      ↓
Recurring problem analysis
      ↓
Demand evidence
      ↓
Competitive analysis
      ↓
Customer pain analysis
      ↓
Market direction
      ↓
Monetization potential
      ↓
Technical feasibility
      ↓
Candidate opportunities
      ↓
Additional/deeper research if necessary
      ↓
Final analysis
      ↓
10 business opportunities
```

Only now should the system generate business ideas.

Exactly 10 final opportunities should normally be produced when enough evidence exists. If evidence quality is insufficient, do not fabricate opportunities merely to reach 10; report the insufficiency explicitly.

---

# 12. Final Opportunity Structure

Each final opportunity should contain:

```text
Name

Problem

Target customer

Evidence discovered

Why the problem appears important

Market/demand signals

Existing solutions/competitors

Observed market gap

Proposed product/service

Possible MVP

Possible business model

Monetization possibilities

Technical complexity

Estimated MVP complexity

Major risks

Distribution/customer acquisition considerations

Why this opportunity emerged from the research

Supporting source references

Confidence/evidence quality

Recommended validation experiments
```

Any scoring should preserve its individual dimensions rather than only a final aggregate number.

Possible dimensions:

```text
Demand evidence
Problem severity
Frequency
Competitive gap
Willingness-to-pay evidence
Market direction
Monetization potential
Technical feasibility
Distribution feasibility
Evidence quality
```

The report should help the user make the decision; it should not pretend uncertain market predictions are facts.

---

# 13. Monthly Telegram Notification

After final analysis:

```text
MONTHLY BUSINESS RESEARCH COMPLETE

Research period:
24 Sep 2026 – 23 Oct 2026

Research days:
30

Items collected:
XXXX

Sources:
XX

Deep analysis:
Completed

Final opportunities:
10

[View Full Report]
```

Do not attempt to send an enormous report as one Telegram message.

Store the complete report in the application/database and provide an appropriate way to retrieve/view it.

---

# 14. Telegram Architecture

Use one Telegram bot initially.

Commands can include:

```text
/status

/client
/client_today

/research
/research_today
/research_status

/cost
/health
```

Telegram is an interface/notification channel.

Telegram is NOT the database.

All important information must exist in PostgreSQL.

---

# 15. Database

Use PostgreSQL + Prisma.

Design normalized models for at least:

```text
BusinessLead
BusinessSource
WebsiteAnalysis
LeadAnalysis
OutreachDraft

ResearchCycle
ResearchSource
ResearchItem
ResearchSignal
ResearchCluster
OpportunityCandidate
FinalOpportunity
MonthlyReport

AutomationRun
JobExecution
AIUsage
DailyReport
SystemError
```

Use appropriate relations, indexes, timestamps and enums.

Prevent unnecessary duplicate leads and duplicate research records.

---

# 16. BullMQ

Create separate queues, for example:

```text
lead-discovery
lead-analysis
website-analysis
pitch-generation

research-collection
research-processing
research-analysis
monthly-analysis

telegram
maintenance
```

Implement:

* retries;
* exponential backoff;
* concurrency limits;
* rate limiting where necessary;
* job IDs/idempotency;
* failure logging.

Restarting the application must not cause completed jobs to execute incorrectly again.

---

# 17. OpenAI Usage

Create one shared `AIService`.

Do not scatter direct OpenAI SDK calls throughout controllers/workers.

Example:

```text
AIService
├── extractStructuredData()
├── classifyResearch()
├── analyzeLead()
├── generatePitch()
├── analyzeResearchCluster()
└── generateFinalOpportunityReport()
```

Use structured JSON/schema outputs wherever possible.

Use cheaper models for:

* classification;
* extraction;
* filtering;
* basic analysis.

Use stronger models only for tasks where they materially improve quality, particularly final research synthesis.

Make model names configurable through environment variables.

---

# 18. AI Cost Controls

Implement usage tracking from the beginning.

Store:

```text
Agent
Job
Model
Input tokens
Output tokens
Estimated cost
Timestamp
```

Configuration:

```env
OPENAI_DAILY_BUDGET_USD=
OPENAI_MONTHLY_BUDGET_USD=
```

Behavior:

```text
80% budget
→ warning

95%
→ Telegram critical warning
→ disable nonessential AI work if configured

100%
→ stop optional AI jobs
→ alert operator
```

Never allow an accidental recursive queue/scheduler bug to consume unlimited API credit.

---

# 19. Observability

Every automation run should record:

```text
Agent
Job type
Start time
Finish time
Duration
Status
Items processed
Items succeeded
Items failed
API usage
AI cost
Error details
```

Critical failures should trigger Telegram alerts.

Example:

```text
ALERT

Research Agent

Reddit collector failed after 3 retries.

Other research workers continue normally.

Error:
[short sanitized error]
```

Never send secrets/tokens through Telegram logs.

---

# 20. Configuration

Use `.env` and NestJS ConfigModule.

Provide `.env.example`.

Expected configuration includes:

```env
DATABASE_URL=

REDIS_HOST=
REDIS_PORT=

OPENAI_API_KEY=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

TIMEZONE=Asia/Kolkata

CLIENT_AGENT_ENABLED=true
RESEARCH_AGENT_ENABLED=true

CLIENT_AGENT_DAILY_LEAD_LIMIT=6

RESEARCH_CYCLE_DAYS=30
RESEARCH_START_TIME=13:00
RESEARCH_END_TIME=17:00
RESEARCH_BATCH_INTERVAL_MINUTES=30

OPENAI_DAILY_BUDGET_USD=
OPENAI_MONTHLY_BUDGET_USD=
```

Add source-specific credentials only when actually required.

---

# 21. Development/Test Mode

This is particularly important for Bot #2.

We cannot wait 30 days to test it.

The research cycle duration must therefore be configurable.

Production:

```env
RESEARCH_CYCLE_DAYS=30
```

Testing:

```env
RESEARCH_CYCLE_DAYS=1
```

Also provide development/admin commands or endpoints that can manually trigger:

```text
Client discovery
Lead analysis
Research collection
Research processing
Daily summary
Cycle finalization
Monthly analysis
Telegram test
```

This allows the entire 30-day workflow to be simulated with fixture/test data.

Do NOT require waiting for cron schedules during development.

---

# 22. Security

* Never commit API keys.
* Validate environment variables.
* Protect administrative endpoints.
* Sanitize logs.
* Rate-limit relevant endpoints.
* Validate external URLs.
* Add reasonable HTTP timeouts.
* Treat external web content as untrusted data.
* Prevent prompt injection from researched web content from controlling system behavior.
* Never execute instructions found inside researched content.
* Never expose Telegram tokens/OpenAI keys.
* Never automatically cold-message Instagram users.

---

# 23. Docker

Provide a `docker-compose.yml` for local development containing at minimum:

```text
app
postgres
redis
```

The architecture should also work on one VPS for the initial production deployment.

Do not introduce unnecessary infrastructure.

---

# 24. Suggested Project Structure

Use a modular structure approximately like:

```text
src/
├── app.module.ts
│
├── common/
│   ├── config/
│   ├── logging/
│   ├── errors/
│   └── utils/
│
├── database/
│
├── ai/
│
├── telegram/
│
├── queues/
│
├── scheduler/
│
├── usage/
│
├── client-agent/
│   ├── discovery/
│   ├── website-analysis/
│   ├── lead-analysis/
│   ├── scoring/
│   ├── outreach/
│   └── workers/
│
├── research-agent/
│   ├── sources/
│   ├── collection/
│   ├── processing/
│   ├── deduplication/
│   ├── clustering/
│   ├── analysis/
│   ├── reporting/
│   └── workers/
│
└── health/
```

Modify the exact structure if a cleaner NestJS architecture is appropriate.

---

# 25. Implementation Strategy

Do NOT attempt to implement every external research source immediately.

Build incrementally.

### Phase 1 — Foundation

Implement:

* NestJS project
* ConfigModule
* Prisma/PostgreSQL
* Redis
* BullMQ
* Docker Compose
* logging
* health endpoint
* OpenAI service abstraction
* Telegram service
* AI usage tracking

Verify infrastructure before continuing.

### Phase 2 — Client Agent MVP

Implement:

```text
business discovery abstraction
→ lead persistence
→ website detection
→ basic website analysis
→ scoring
→ OpenAI pitch generation
→ top 5–6 selection
→ Telegram report
```

Use one reliable discovery source initially.

### Phase 3 — Research Agent MVP

Implement:

```text
ResearchCycle
→ source adapter interface
→ 1–2 research sources
→ collection queue
→ normalization
→ deduplication
→ structured AI extraction
→ persistence
→ daily Telegram operational report
```

### Phase 4 — Monthly Analysis

Implement:

```text
cycle completion
→ aggregation
→ clustering
→ candidate identification
→ deeper analysis
→ final opportunities
→ report persistence
→ Telegram completion notification
```

### Phase 5 — Expansion

After the core system is proven:

* add more research sources;
* improve lead discovery;
* improve website auditing;
* add dashboard if needed;
* improve semantic clustering;
* add historical cross-cycle analysis.

---

# 26. Testing Requirements

Add:

* unit tests for scoring;
* unit tests for research normalization;
* unit tests for deduplication;
* scheduler tests;
* queue processor tests;
* mocked OpenAI tests;
* mocked Telegram tests;
* integration tests for Prisma;
* end-to-end happy-path test for each agent.

The monthly research workflow must be testable without waiting 30 real days.

---

# 27. Initial Codex Task

Start by inspecting the existing repository.

If the repository is empty, initialize the NestJS project.

If an application already exists, understand its structure before modifying it.

Then:

1. Produce a concise implementation plan.
2. Identify required dependencies.
3. Create the initial architecture.
4. Configure PostgreSQL/Prisma.
5. Configure Redis/BullMQ.
6. Configure environment validation.
7. Add Docker Compose.
8. Create the core database schema.
9. Implement basic health checks.
10. Implement shared Telegram and OpenAI service abstractions.
11. Implement AI usage/cost tracking foundations.
12. Add tests for the infrastructure created.
13. Run lint/typecheck/tests.
14. Fix errors before proceeding.

Do not implement all external integrations in one pass.

After the foundation works, proceed with Bot #1, followed by Bot #2.

When an external service/API choice is uncertain, create an interface/adapter and clearly mark the integration as pending rather than inventing credentials, endpoints, API behavior, or unsupported scraping.

At the end of each implementation phase, report:

* files created/modified;
* architecture implemented;
* commands/tests run;
* test results;
* environment variables required;
* unresolved external integrations;
* recommended next implementation step.
