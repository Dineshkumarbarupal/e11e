# Product roadmap and progress meter

**Progress snapshot: approximately 40% of a broad n8n-like MVP scope.** This is a rough engineering estimate, not test coverage, enterprise readiness or feature parity with n8n.

## Implemented in this repository
- [x] Requested root folders and UI theme structure under `26.00.00/theme/AppName_Basic/User/`
- [x] Premium responsive dashboard, navigation, workflow library and execution-history screens
- [x] Visual node canvas, node drag-to-position, connector handles, zoom controls and selected-node inspector
- [x] IF node's true/false branch handles and connection management
- [x] Seven node types: Manual Trigger, Edit Fields, HTTP Request (browser demo only), IF, Merge, Wait and Log/Output
- [x] Workflow structure validation, local persistence, JSON import/export and per-node test output
- [x] Local execution history and run export
- [x] Browser UI sign-in/register to server, manual workflow push/pull, server-side queue and server run-history loading
- [x] Fastify API with JWT auth, bcrypt password hashes, PostgreSQL migrations and workspace membership checks
- [x] Encrypted credential persistence (AES-256-GCM), credential metadata API and audit log API
- [x] Redis/BullMQ queue plus a separate worker process
- [x] Browser engine unit tests and server schema tests
- [x] GitHub Actions workflow configured for JS syntax, tests and static build
- [x] API/security/architecture/deployment documentation

## Not implemented yet
- [ ] Real webhook ingress/signature verification and schedule/cron triggers
- [ ] Production outbound HTTP node and credential references; server HTTP execution is intentionally disabled
- [ ] Full integrations catalog, OAuth authorization lifecycle, node SDK and community-node management
- [ ] Complete control flow: loops, parallel joins, durable waits/resume, cancellation, node-level retries and replay
- [ ] AI agents, supported LLM adapters, tool permissions, vector DB/RAG and human approvals
- [ ] SSO/MFA, account verification/password reset, session revocation, workspace invites and role administration
- [ ] UI credential vault, environment promotion, reusable sub-workflows and collaboration
- [ ] Frontend conflict resolution/continuous synchronization and complete server execution-detail UI
- [ ] Tenant isolation review, comprehensive authorization tests, audit completeness and data retention/deletion policy
- [ ] End-to-end/browser/accessibility/load/security tests and independent threat model review
- [ ] CI result verification, deployment automation, metrics/traces, alerting, backups and disaster-recovery drills

## Current behavior
The browser application stores workflows and local run history in localStorage. API login can save a short-lived token in sessionStorage. Server workflow sync is explicit (push/pull), not continuous. The server worker supports only Manual, Edit Fields, IF, Merge, Wait and Log/Output. The browser HTTP node is a non-sensitive demo feature with CORS constraints. The server HTTP node intentionally refuses execution until secure egress controls and credential references are available.

## Run and verify
```bash
npm install
npm run check
npm test
npm run build
npm install --prefix server
npm --prefix server run check
npm --prefix server test
```
For the server, configure PostgreSQL and Redis and use the `server/.env.example` template. GitHub Actions is configured to execute these checks; consult the repository's Actions tab for real run results. A configured workflow is not proof of passing status.

## Enterprise definition of done
Every feature needs input/schema validation, authorization checks, unit/integration tests, failure semantics, logs/metrics, security review, documentation, deployment automation and recovery procedures. Update progress only after observable implementation and verification.
