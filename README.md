# e11e Flow — Workflow Automation Studio

e11e Flow is an original workflow-automation project with a browser-based visual editor MVP and a separately deployable Fastify API/worker. It is inspired by common automation patterns and does not copy n8n source code or branding.

> **Status:** functional early MVP, not full n8n parity and not enterprise-ready. See [Roadmap](docs/ROADMAP.md) and [Security](SECURITY.md).

## Browser product features
- Premium responsive dark dashboard, navigation, workflow list and execution-history screens
- Visual node canvas: move nodes, connect nodes, zoom, inspect/edit node config, remove connections
- IF node with separate true/false output handles
- Seven node types: Manual Trigger, Edit Fields, HTTP Request, IF, Merge, Wait and Log/Output
- Local workflow validation, browser-local persistence, JSON import/export and node-by-node test output
- Local test-run history and execution JSON export
- Optional API sign-in/register, push/pull workflow sync, server-queue execution and server execution-history loading

Browser workflows and local run history are stored in `localStorage`. The API JWT is kept in `sessionStorage` for the current browser tab. Browser HTTP requests depend on browser CORS and are only suitable for non-sensitive testing. Never store secrets in workflow fields.

## Server foundation
- Fastify REST API with JWT authentication and password hashing
- PostgreSQL schema for users, workspaces, memberships, workflows/versions, executions, encrypted credentials and audit events
- Workspace member checks, viewer write restrictions, input validation, rate limits and explicit CORS origins
- AES-256-GCM encryption for credential payloads; API responses expose metadata only
- Redis/BullMQ queue plus separate worker process
- Server worker supports Manual Trigger, Edit Fields, IF, Merge, Wait and Log/Output with a bounded step budget
- Server-side HTTP node execution is deliberately disabled until outbound network security and credential-reference support are implemented

## Important gaps
The app is **not a complete n8n replacement**. Webhook listeners, schedule/cron triggers, loop node semantics, durable wait/resume, server-side secure HTTP/integration runtime, broad integration catalog, OAuth lifecycle, AI agents/LLM tools/RAG, human approvals, collaboration/invites, SSO/MFA, retention/deletion controls, observability and production hardening are still incomplete. The API foundation has not received independent security review or a full integration/load test. Do not expose it publicly or use production credentials.

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
Requires Node.js 24 LTS or newer. Node 24 is the project's supported runtime target.
```bash
npm install
npm run check
npm test
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
Use one output for `JWT_SECRET` (at least 32 characters) and one for `CREDENTIAL_ENCRYPTION_KEY_HEX` (exactly 64 hex characters). Set PostgreSQL/Redis URLs and exact frontend origins in `server/.env`.

Then:
```bash
npm install --prefix server
npm run server:migrate
npm run server:dev
```
In another terminal:
```bash
npm run server:worker
```
Health checks: `GET /healthz` and `GET /readyz`. See [API notes](docs/API.md).

## CI and deployment
GitHub Actions is configured to run browser syntax checks/unit tests, server syntax checks/schema tests and a Vite production build. The Actions tab is the source of truth for the live result; configuration alone does not mean that checks passed.

- Free frontend demo: Cloudflare Pages, build command `npm run build`, output directory `dist`.
- API/worker require Node.js hosting, PostgreSQL and Redis. A static Pages site alone cannot run the worker.
- See [Deployment guide](docs/DEPLOYMENT.md) and [Security policy](SECURITY.md).

## License
A license has not been selected. Choose distribution and commercial terms before adding one.
