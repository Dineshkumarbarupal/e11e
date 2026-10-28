# e11e Flow — Workflow Automation Studio

e11e Flow is an original workflow-automation project with a browser-based visual editor MVP and a separately deployable Fastify API, worker and schedule service. It is inspired by common automation patterns and does not copy n8n source code or branding.

> **Status:** functional early MVP, not full n8n parity and not enterprise-ready. See [Roadmap](docs/ROADMAP.md) and [Security](SECURITY.md).

## Browser product features
- Premium responsive dark dashboard, navigation, workflow list and execution-history screens
- Visual node canvas: move nodes, connect nodes, zoom around the viewport, auto-fit the workflow when opened, retain the canvas position when selecting nodes, and avoid overlapping placement for new nodes. Canvas placement/sizing logic is isolated in a tested helper module
- IF node with separate true/false output handles
- Ten node types: Manual Trigger, Webhook Trigger, Schedule Trigger, Edit Fields, HTTP Request, IF, Merge, Loop Over Items, Wait and Log/Output
- Global workflow search, responsive workflow-list filtering and keyboard shortcut (Ctrl/Cmd+K)
- Editable JSON test payloads for browser runs and server-queued runs; selecting a Webhook or Schedule Trigger tests from that node locally
- UTC Schedule Trigger with five-field cron expressions, a dedicated scheduler process, PostgreSQL slot deduplication and queue-enqueue retries
- Bounded Loop Over Items node with nested array paths, per-item downstream fan-out, item metadata and configurable maximum of 1–100 items
- HTTP Request nodes support bounded retries for transient network failures, HTTP 429 and 5xx; retries are disabled by default and ordinary 4xx errors do not retry
- Local workflow validation, browser-local persistence, JSON import/export and node-by-node test output
- Local test-run history and execution JSON export
- Regression tests for UI asset order/existence, responsive styles, canvas layout, workflow validation and execution semantics
- Optional API sign-in/register, push/pull workflow sync, server-queue execution and server execution-history loading

Browser workflows and local run history are stored in `localStorage`. The API JWT is kept in `sessionStorage` for the current browser tab. Browser HTTP requests depend on browser CORS and are only suitable for non-sensitive testing. The webhook token header is included in the API CORS allow-list for configured frontend origins. Never store secrets in workflow fields.

## Server foundation
- Fastify REST API with JWT authentication and password hashing
- PostgreSQL schema for users, workspaces, memberships, workflows, immutable workflow-version snapshots, executions, encrypted credentials and audit events
- Workflow version history with immutable create/update snapshots, version list/detail endpoints, path-level diff against latest, and permission-checked restore that creates a new version
- Workspace member checks, viewer write restrictions, input validation, rate limits and explicit CORS origins
- AES-256-GCM encryption for credential payloads; API responses expose metadata only, and workspace owners can rotate a vault secret without revealing the old value
- Redis/BullMQ queue plus separate worker process; atomic execution claims avoid rerunning already-running/successful execution rows on duplicate jobs, while failed jobs remain retryable
- Workspace-scoped server execution cancellation from execution history; queued jobs are removed where possible and running workflows check the cancellation flag between nodes
- Server worker supports Manual Trigger, Webhook Trigger, Schedule Trigger, Edit Fields, IF, Merge, Wait, Log/Output and a bounded HTTP Request node
- Optional webhook event-ID deduplication through `x-e11e-event-id` or `Idempotency-Key`; event IDs are hashed and duplicate deliveries reuse the existing execution
- Optional HMAC-SHA256 signed webhook payloads with encrypted signing secrets, signed event IDs and a five-minute timestamp tolerance
- Public webhook routes have configurable per-source/per-hook request limits; the default in-memory limiter is process-local, so scaled deployments need a shared rate-limit store
- Server HTTP uses an exact `HTTP_ALLOWED_HOSTS` list, HTTPS on port 443, pinned DNS addresses, public-IP checks, no automatic redirects, request/response size limits, bounded retries and workspace-scoped encrypted credential references
- UTC cron scheduler that holds a PostgreSQL advisory lock, persists the last-fired minute per workflow/node and retries queued schedule executions when Redis is temporarily unavailable
- Server HTTP is disabled unless the operator explicitly configures exact allowed hostnames in `HTTP_ALLOWED_HOSTS`; an empty list keeps outbound HTTP disabled

## Important gaps
The app is **not a complete n8n replacement**. General loop cycles/parallel joins, durable wait/resume, immediate interruption of an in-flight node, workflow-version retention/pruning and optimistic concurrency conflict handling, full integration runtime/catalog, OAuth lifecycle, AI agents/LLM tools/RAG, human approvals, collaboration/invites, SSO/MFA, retention/deletion controls, scheduler monitoring/misfire recovery and production hardening are still incomplete. The secure HTTP node has not received an independent security review or live network integration test; timezone/DST rules and schedule backfill are also absent. Schedule expressions currently use UTC and do not implement timezone/DST rules or backfill missed runs. The latest confirmed GitHub Actions run (commit `a808d28df3cfb5aa0b9f38dd4829d1cdd2a312e1`, run `40665209982`) passed 54 root/browser tests, 109 server/security tests, syntax checks and the Vite production build. Live Docker/PostgreSQL/Redis migration/restore tests, real external HTTPS integration tests, multi-instance shared limiting, independent security review and load tests remain outstanding. Do not expose it publicly or use production credentials.

## Requested directory convention
```text
AppName/
├── 25.00.00/
├── 26.00.00/theme/AppName_Basic/User/
│   ├── asset/ component/ css/ event/ flyout/ icon/
│   ├── js/ layout/ php/ screen/ section/
├── server/
│   ├── migrations/
│   ├── src/
│   └── test/
├── docs/
└── .github/workflows/
```

## Run the browser MVP
Requires Node.js 24 LTS or newer. Node 24 is the project's supported runtime target. The Node.js release schedule marks 24.x as Active LTS and 20.x as EOL; see [official releases](https://nodejs.org/en/about/previous-releases). Vite's currently supported lines are documented in [Vite releases](https://vite.dev/releases).
```bash
npm install
npm run check
npm test  # workflow engine, canvas layout, UI asset, and cron tests
npm run build
npm run dev
```
Open the Vite URL printed in the terminal.

## Run the API + worker
Prerequisites: PostgreSQL and Redis. Copy `server/.env.example` to `server/.env`; replace placeholders and never commit real environment files.

Generate two independent secrets:
```bash
openssl rand -hex 32
openssl rand -hex 32
```
Use one output for `JWT_SECRET` (at least 32 characters) and one for `CREDENTIAL_ENCRYPTION_KEY_HEX` (exactly 64 hex characters). Set PostgreSQL/Redis URLs and exact frontend origins in `server/.env`. To enable server HTTP, set `HTTP_ALLOWED_HOSTS` to a comma-separated list of exact HTTPS hostnames; leave it blank to keep outbound HTTP disabled.

Then:
```bash
npm install --prefix server
npm run server:migrate
npm run server:dev
```
In another terminal:
```bash
npm run server:worker
npm run server:scheduler
```
The scheduler polls every 15 seconds and evaluates five-field cron schedules in UTC. `docker compose up --build` runs it as a separate service. Health checks: `GET /healthz` and `GET /readyz`. See [API notes](docs/API.md).

## CI and deployment
GitHub Actions is configured to run browser syntax checks/unit tests, server syntax checks/schema tests and a Vite production build. The Actions tab is the source of truth for the live result; configuration alone does not mean that checks passed.

- Free frontend demo: Cloudflare Pages, build command `npm run build`, output directory `dist`.
- API/worker require Node.js hosting, PostgreSQL and Redis. A static Pages site alone cannot run the worker.
- See [Deployment guide](docs/DEPLOYMENT.md) and [Security policy](SECURITY.md).

## License
A license has not been selected. Choose distribution and commercial terms before adding one.
