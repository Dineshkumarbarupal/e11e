# Product roadmap and progress meter

**Progress snapshot: approximately 54% of a broad n8n-like MVP scope.** This is a rough engineering estimate, not test coverage, enterprise readiness or feature parity with n8n.

## Implemented in this repository
- [x] Requested root folders and UI theme structure under `26.00.00/theme/AppName_Basic/User/`
- [x] Premium responsive dashboard, navigation, workflow library and execution-history screens
- [x] Cohesive premium theme layer aligned to the actual app shell, with responsive editor layouts and accessible focus states
- [x] Global workflow search (Enter / Ctrl+K / Cmd+K) plus a visible mobile-friendly workflow-list filter
- [x] Workflow canvas auto-fit, dynamic scroll bounds, preserved viewport on node selection, and collision-aware node placement
- [x] Pure canvas-layout helpers for node placement and dynamic dimensions, covered by a dedicated layout test file
- [x] UI asset regression tests verify style order/existence, premium CSS delimiter balance, and key editor controls
- [x] Visual node canvas, node drag-to-position, connector handles, zoom controls and selected-node inspector
- [x] IF node's true/false branch handles and connection management
- [x] Nine node types: Manual Trigger, Webhook Trigger, Schedule Trigger, Edit Fields, HTTP Request (browser and allow-listed server HTTPS modes), IF, Merge, Wait and Log/Output
- [x] Workflow structure validation, local persistence, JSON import/export and per-node test output
- [x] Editable JSON test input shared by local and server-queued runs; explicit webhook-node selection for local trigger tests
- [x] Local execution history and run export
- [x] Browser UI sign-in/register to server, manual workflow push/pull, server-side queue and server run-history loading
- [x] Fastify API with JWT auth, bcrypt password hashes, PostgreSQL migrations and workspace membership checks
- [x] Encrypted credential persistence (AES-256-GCM), credential metadata API, workspace-scoped credential lookup for server HTTP and audit log API
- [x] Guarded server HTTP execution: explicit exact-host allow-list, HTTPS/443 only, DNS validation and pinned IP, private/reserved IP rejection, no auto-follow redirects, bounded response/request sizes and optional encrypted-vault credential headers
- [x] Redis/BullMQ queue plus a separate worker process
- [x] Token-protected webhook endpoints with per-node SHA-256 token hashes, trigger-specific execution and optional event-ID deduplication
- [x] UTC five-field cron Schedule Trigger, schema validation, singleton scheduler lock, persistent last-fired slots and retries for queued schedule jobs
- [x] Explicit CORS allow-list includes the webhook token header for configured browser origins
- [x] Tracked SQL migrations, local Docker Compose services and server worker tests
- [x] Browser engine unit tests and server schema tests
- [x] Expanded regression coverage for false IF branches, nested interpolation, rejected non-HTTP URL schemes, shared IF branch targets and incoming edges to trigger nodes
- [x] Cron parser/matcher and scheduler-core tests for UTC matching, invalid expressions, active workflow selection and deduplication keys
- [x] UI asset regression suite 8/8; custom harness verifies workflow/canvas/cron/scheduler-core suites, server executor 8/8, secure HTTP policy 9/9 and webhook event-ID helper 6/6. Fastify webhook idempotency integration tests are committed but not executed here; native full test commands, production build and hosted CI result remain unverified
- [x] Root `npm test` includes workflow engine, canvas layout, UI asset and cron tests; root `npm run check` checks canvas and cron helper syntax
- [x] Server tests cover cron matching, schedule-node schema validation, execution starting at a scheduled node, and due-schedule selection
- [x] Regression test proving an explicit webhook trigger starts the matching node instead of the manual trigger
- [x] GitHub Actions workflow configured for JS syntax, tests and static build
- [x] API/security/architecture/deployment documentation

## Not implemented yet
- [x] Optional webhook event-ID idempotency using hashed event IDs and a partial unique database index
- [ ] Provider-specific webhook signature validation, per-hook quotas and advanced replay controls
- [ ] Timezone/DST schedules, missed-run backfill policy, scheduler metrics/alerts and large-scale partitioned scheduling
- [x] Server HTTP credential-reference binding and encrypted workspace resolution
- [ ] Independent SSRF/security review, live HTTPS integration tests, egress policy administration, credential rotation/KMS, and production HTTP operations
- [ ] Full integrations catalog, OAuth authorization lifecycle, node SDK and community-node management
- [ ] Complete control flow: loops, parallel joins, durable waits/resume, cancellation, node-level retries and replay
- [ ] AI agents, supported LLM adapters, tool permissions, vector DB/RAG and human approvals
- [ ] SSO/MFA, account verification/password reset, session revocation, workspace invites and role administration
- [x] UI credential vault for encrypted create/list/delete and metadata-only listing
- [ ] Credential rotation/KMS, environment promotion, reusable sub-workflows and collaboration
- [ ] Frontend conflict resolution/continuous synchronization and complete server execution-detail UI
- [ ] Tenant isolation review, comprehensive authorization tests, audit completeness and data retention/deletion policy
- [ ] End-to-end/browser/accessibility/load/security tests and independent threat model review
- [ ] CI result verification, deployment automation, metrics/traces, alerting, backups and disaster-recovery drills

## Current behavior
The browser application stores workflows and local run history in localStorage. API login can save a short-lived token in sessionStorage. Server workflow sync is explicit (push/pull), not continuous. The editor supports canvas auto-fit, non-overlapping node placement, preserved scroll position while editing, and editable JSON test payloads. The server worker supports Manual, Webhook, Schedule, Edit Fields, IF, Merge, Wait and Log/Output. The separate UTC scheduler polls every 15 seconds, persists each fired minute by workflow/node, and retries enqueueing queued schedule executions if Redis is unavailable. It does not support timezone/DST rules or missed-run backfill. The browser HTTP node is a non-sensitive demo feature with CORS constraints. The server HTTP node requires an explicit exact-host `HTTP_ALLOWED_HOSTS` allow-list, HTTPS on port 443 and same-workspace encrypted credential references. Private IPs and redirects are rejected; live-network QA, independent security review and operational hardening remain outstanding.

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
