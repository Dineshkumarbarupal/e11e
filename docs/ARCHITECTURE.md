# Architecture and security

## Target architecture (planned, not implemented)

Browser UI -> Fastify API -> PostgreSQL workflow definitions and versions. Webhook ingress validates signatures and rate limits requests. API enqueues jobs in Redis/BullMQ. Isolated workers execute validated node definitions with timeouts, retries, idempotency keys and bounded concurrency. Execution events flow to logs and metrics.

## Enterprise controls required before production
- OIDC/SAML SSO, MFA policy, workspace RBAC and tenant isolation
- KMS/Vault-backed envelope encryption for credentials; redact secrets from logs
- Webhook signatures, rate/body limits, strict CORS and secure cookies
- SSRF protection for HTTP nodes, redirect/DNS validation and private-IP blocking
- Sandboxed code execution, node allowlists, outbound egress policy and resource limits
- Audit events for auth, credentials, workflow edits, activation and manual runs
- Structured logs, traces, metrics, alerting and dead-letter queue
- PostgreSQL backups and tested restore, retention/deletion controls and incident runbooks
- Dependency/SBOM scanning, secret scanning, signed builds and CI checks

Workflow definitions, webhook payloads and third-party nodes must be treated as untrusted input. The current scaffold has no authentication, database, queue, secret vault or execution sandbox.
