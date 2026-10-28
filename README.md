# e11e Flow — Workflow Automation Studio

e11e Flow is an original workflow-automation project with a browser-local visual editor MVP and a separately deployable Fastify API/worker foundation. It is inspired by common automation patterns; it does not copy n8n source code or branding.

> **Status:** early MVP. This repository does not provide full n8n feature parity and is not yet suitable for production automation. Read [Roadmap](docs/ROADMAP.md) and [Security](SECURITY.md).

## What works in the browser MVP
- Premium responsive dark dashboard and node canvas
- Drag nodes around the canvas; connect nodes; IF nodes have true/false handles
- Seven local node types: Manual Trigger, Edit Fields, HTTP Request, IF, Merge, Wait and Log/Output
- Node inspector, node configuration, connection removal, workflow validation
- Create workflow, local save, import/export JSON
- Test execution with per-node inputs/outputs, local history and execution JSON export
- Unit tests for the local workflow engine

Browser workflow data lives in localStorage. The browser HTTP node depends on CORS and should be used only for non-sensitive test calls. Do not store secrets in browser workflow fields.

## Server foundation
- Fastify API with JWT-based authentication
- PostgreSQL schema for users, workspaces, memberships, workflows, executions, encrypted credentials and audit events
- Workspace membership checks, viewer write restrictions, request validation and rate limits
- AES-256-GCM encryption at rest for credential payloads
- Redis/BullMQ background execution queue
- Worker for safe built-in nodes (Manual, Set, IF, Merge, Wait, Log)
- The server HTTP node is deliberately disabled until a production-grade outbound network policy and credential-reference flow exists.

**The browser UI is not yet connected to the server API.** Users currently see browser-local workflows; the server API is a separately runnable foundation. User invites, SSO, role administration, webhook listeners, cron triggers, broad integration catalog, AI agent nodes, collaboration, retention controls and end-to-end production hardening are not implemented.

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
Requires Node.js 20+.
```bash
npm install
npm run check
npm test
npm run build
npm run dev
```
Open the local Vite URL shown in the terminal.

## Run the API server
Prerequisites: a reachable PostgreSQL database and Redis instance. Copy `server/.env.example` to `server/.env` and replace every placeholder. Do not commit real environment files.

Generate secrets, for example:
```bash
openssl rand -hex 32
openssl rand -hex 32
```
Use the first output for `JWT_SECRET` (minimum 32 characters) and the second for `CREDENTIAL_ENCRYPTION_KEY_HEX` (exactly 64 hexadecimal characters). Set the database/Redis URLs and allowed CORS origin in `server/.env`.

Then:
```bash
npm install --prefix server
npm run server:migrate
npm run server:dev
```
In a second terminal, start the background worker:
```bash
npm run server:worker
```
API health endpoints: `GET /healthz` and `GET /readyz`. See [server API notes](docs/API.md).

## Build and tests
GitHub Actions is configured to run browser JS checks, workflow engine unit tests, server JS checks, server schema tests and the Vite production build on pushes/PRs. Check the Actions tab for live results; no passing status should be inferred from configuration alone.

## Deployment
- Static demo: Cloudflare Pages, build command `npm run build`, output directory `dist`.
- Full-stack API: requires Node.js hosting plus PostgreSQL and Redis. A static Pages deployment alone cannot run the server worker. Free-tier limits can change; check provider terms before selecting infrastructure.
- See [Deployment guide](docs/DEPLOYMENT.md).

## License
A project license has not yet been selected. Decide distribution and commercial terms before choosing one.
