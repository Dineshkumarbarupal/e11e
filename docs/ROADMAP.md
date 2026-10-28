# Roadmap and progress meter

**Current estimate: 8% of broad n8n-like product scope.** This is a planning estimate, not test coverage or enterprise readiness.

## Completed in initial scaffold
- [x] Repository and requested theme directory structure
- [x] Responsive premium dark dashboard prototype
- [x] Sample workflow list and navigation
- [x] Architecture, security and deployment notes

## Not yet implemented
- [ ] Node-based visual editor and workflow JSON schema
- [ ] API server, PostgreSQL migrations and authentication
- [ ] Workspace tenancy, RBAC and audit log
- [ ] Webhook, schedule and manual triggers
- [ ] Execution engine, retries, timeouts, cancellation and idempotency
- [ ] Redis queue and isolated workers
- [ ] HTTP, transform, condition, merge, loop and code nodes
- [ ] Integration registry, OAuth and encrypted credentials
- [ ] Per-node execution data, logs, replay and debugging
- [ ] AI/LLM nodes, tools, approvals and budget guardrails
- [ ] Automated tests, security review, load tests, CI/CD and production deployment

A feature is done only when authorization, validation, tests, failure handling, observability and documentation exist. The current app is a static UI demo; it must not be exposed as a production automation service.
