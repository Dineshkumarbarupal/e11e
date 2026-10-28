# Product roadmap and progress meter

**Progress snapshot: approximately 28% of an early n8n-like MVP scope.** This is an engineering estimate, not test coverage, business readiness or parity with n8n. The full enterprise/product parity scope remains much larger.

## Implemented in this repository
- [x] Requested root folders and theme directories under `26.00.00/theme/AppName_Basic/User/`
- [x] Premium dark responsive UI, workspace navigation and dashboard
- [x] Visual node canvas with drag-to-position, connectors, selected-node inspector, zoom controls
- [x] Seven node types: Manual Trigger, Edit Fields, HTTP Request, IF, Merge, Wait and Log/Output
- [x] True/false connector handles for IF nodes
- [x] Workflow validation, browser-local save, create, edit, import and export JSON
- [x] Local test executor with per-node input/output, bounded steps, HTTP timeout and failure reporting
- [x] Local execution history and JSON export
- [x] Node built-in unit tests and GitHub Actions test/build workflow configured
- [x] Architecture, security and deployment documentation

## Not implemented yet
- [ ] Server API, database migrations, durable shared storage and workflow version history
- [ ] User authentication, multi-tenant isolation, RBAC, SSO and audit logs
- [ ] Real webhook ingress and schedule/cron triggers
- [ ] Durable queue, Redis workers, retries, cancellation, concurrency management and dead-letter queue
- [ ] Credential vault, OAuth flows, KMS-based encryption and secret rotation
- [ ] Large integration catalog, integration SDK, community nodes and node version compatibility
- [ ] Robust loop/wait-for-event semantics, parallel branch join behavior and full workflow semantics
- [ ] Production HTTP node SSRF protections, outbound egress policy and code-node sandbox
- [ ] AI agents, model provider adapters, tool permissions, vector DB/RAG and human approvals
- [ ] Collaboration, project sharing, environment promotion, reusable sub-workflows and enterprise governance
- [ ] End-to-end, browser, security, load and disaster-recovery tests
- [ ] Production deploy, logs/metrics/tracing, alerting, backups and restore drills

## Run locally
Requires Node.js 20+.
```bash
npm install
npm test
npm run build
npm run dev
```

## What the current completion estimate means
The current build is a **browser-local workflow MVP**. Workflows and run history live in localStorage. HTTP Request nodes call fetch from the browser and may be blocked by CORS; never place production secrets into the UI. The Activate button only sets a local flag and does not schedule or listen for events. No login, server database, shared teams, server-side workers or secure secret vault is present. Do not expose this version as an enterprise production automation server.

## Enterprise definition of done
Each feature needs schema validation, authorization checks, unit/integration tests, failure handling, logs/metrics, security review, documentation and an automated deployment path. Percent-complete must be updated only after observable implementation and verification.
