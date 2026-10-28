# e11e Flow API foundation

The API runs separately from the static frontend. The UI can sign in/register, push or pull workflow definitions, queue server executions and load server execution history. Workflow edits still save locally first; sync to server is manual. Some API endpoints remain intended for direct API-client use.

## Start local services
You need PostgreSQL and Redis. Copy `server/.env.example` to `server/.env`; provide real values locally and never commit them.

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

## Health checks
- `GET /healthz` — process responds.
- `GET /readyz` — tests PostgreSQL and Redis connectivity.

## Authentication
- `POST /api/auth/register` JSON: `{"email":"you@example.com","name":"Example User","password":"use-a-unique-password-of-12-or-more-characters"}`
- `POST /api/auth/login` JSON: `{"email":"you@example.com","password":"your-password"}`
- `GET /api/me` with `Authorization: Bearer <token>`
Registration creates a personal workspace. Tokens expire after 30 minutes; refresh and password reset are not implemented.

## Authenticated workspace endpoints
Include `Authorization: Bearer <token>` on each request:
- `GET /api/workspaces`
- `POST /api/workspaces` JSON: `{"name":"Automation team"}`
- `GET /api/workspaces/:workspaceId/workflows`
- `POST /api/workspaces/:workspaceId/workflows` — JSON workflow definition with `name`, `active`, `nodes`, `edges`.
- `GET /api/workspaces/:workspaceId/workflows/:workflowId`
- `PUT /api/workspaces/:workspaceId/workflows/:workflowId` — complete workflow definition.
- `DELETE /api/workspaces/:workspaceId/workflows/:workflowId`
- `POST /api/workspaces/:workspaceId/workflows/:workflowId/executions` JSON: `{"input":{"example":"value"}}`; responds `202` after enqueue.
- `GET /api/workspaces/:workspaceId/executions`
- `GET /api/workspaces/:workspaceId/executions/:executionId`
- `GET /api/workspaces/:workspaceId/credentials` — metadata only; plaintext is never returned.
- `POST /api/workspaces/:workspaceId/credentials` JSON: `{"name":"Demo token","service":"sample","secret":{"token":"placeholder"}}`.
- `PUT /api/workspaces/:workspaceId/credentials/:credentialId` JSON uses the same `name`, `service` and replacement `secret` fields; it re-encrypts the new payload, updates `updated_at`, writes an audit event and returns metadata only. The old secret is never read back or returned.
- `DELETE /api/workspaces/:workspaceId/credentials/:credentialId`
- `GET /api/workspaces/:workspaceId/audit-logs` (owner/admin only).


## Token-protected webhook triggers

Add a Webhook Trigger node to a workflow, sign in to the frontend, and use the node inspector's Generate / rotate endpoint token action. The token is returned once and only its SHA-256 hash is stored in PostgreSQL. Copy it into your external event source's secret header configuration.

- Create or rotate a node token: POST /api/workspaces/:workspaceId/workflows/:workflowId/nodes/:nodeId/webhook-token (JWT required).
- Trigger execution: POST /api/webhooks/:workflowId/:nodeId with the header x-e11e-webhook-token: TOKEN and a JSON request body.
- A public webhook returns 202 with an execution id after adding a job to Redis/BullMQ.
- The workflow must be saved and active on the server. If it was edited in the browser, sync it after toggling the Active flag.
- Token rotation invalidates the previous token. The server redacts webhook tokens from request logs.
- Optional signed payloads: enable `requireSignature: true` on the Webhook Trigger node, sync it to the server, then rotate the endpoint token and securely save the returned one-time signing secret. Send `x-e11e-event-id` (or `Idempotency-Key`), `x-e11e-webhook-timestamp` (10-digit Unix seconds) and `x-e11e-webhook-signature` (`sha256=` followed by 64 hex characters). Compute HMAC-SHA256 over `timestamp + "." + eventId + "." + canonicalJson(body)`, where object keys are recursively sorted and arrays retain their order. The event ID is required and signed, so changing it invalidates the signature; timestamps outside a ±5-minute window are rejected. Only the signing secret is stored encrypted. These headers are permitted by configured-origin CORS preflight.
- Optional retry deduplication: send `x-e11e-event-id` or `Idempotency-Key` with a 1–128 character value using letters, digits, dot, underscore, colon or hyphen. Repeated IDs for the same workspace/workflow/trigger return HTTP 200 with the previous execution ID/status and `duplicate: true`; no second queue job is created. The raw event ID is SHA-256 hashed before storage. Omit the header for legacy non-deduplicated behavior. If Redis enqueueing fails, the deduplication key is released so a provider retry can create a new execution.
- Public webhook routes default to 60 requests/minute per source IP per webhook endpoint; tune this using `WEBHOOK_RATE_LIMIT_MAX`. This first limiter is process-local and is not shared between API replicas. Multi-instance deployments still need a shared Redis-backed limiter and metrics.
- Generic HMAC signing is implemented; provider-specific signature formats, stronger replay/abuse controls and end-to-end security tests still need work.
- Browser callers must use an origin configured in `CORS_ORIGINS`; the API CORS allow-list includes `x-e11e-webhook-token`, `x-e11e-event-id` and `idempotency-key` for webhook preflight.


## UTC schedule triggers

Add a Schedule Trigger node with a five-field cron expression: `minute hour day-of-month month day-of-week`. Supported field syntax includes numbers, `*`, ranges (`1-5`), comma lists (`1,3,5`) and steps (`*/15`). Day-of-week accepts `0` or `7` for Sunday. Expressions are evaluated in UTC; timezone names, daylight-saving rules and missed-run backfill are not implemented.

Example: `0 9 * * 1-5` runs at 09:00 UTC Monday through Friday. Save and sync the workflow, then set its server-side Active flag. Start the scheduler and worker with `npm run server:scheduler` and `npm run server:worker`, or use Docker Compose.

The scheduler polls every 15 seconds, uses a PostgreSQL advisory lock to ensure only one scheduler instance fires a slot, persists the last-fired minute per workflow/node, and records queued execution rows before adding jobs to Redis/BullMQ. If Redis enqueueing fails, PostgreSQL rows remain queued and are retried on a later poll. The Compose stack includes a separate scheduler service.

Production gaps remain: no timezone/DST support, missed-run backfill, per-schedule concurrency controls, scheduler health endpoint or alerting. Monitor process logs and database/queue health in non-demo deployments.

## Secure server HTTP request nodes

Server-side HTTP is disabled by default. Set `HTTP_ALLOWED_HOSTS` in `server/.env` to an explicit comma-separated list of exact DNS hostnames (for example `api.example.com`). Wildcards, IP literals and non-allow-listed hostnames are not accepted. Requests use HTTPS on port 443 only. DNS answers are checked against private, loopback, link-local, documentation and other reserved IP ranges; the chosen public IP is pinned for the TLS request to reduce DNS-rebinding risk. Redirects are not automatically followed.

The HTTP node may reference a credential saved in the same workspace using its `credentialId` UUID. Configure `credentialField` (default `token`), `credentialHeader` (default `Authorization`) and `credentialPrefix` (default `Bearer`; blank sends the raw value). The execution worker verifies workspace ownership before decrypting the secret. Inline authorization/API-token headers are rejected. The plaintext secret is not copied into workflow definition or run input.

Request bodies are limited to 64 KiB, response bodies to 1 MiB, and the request timeout is capped at 30 seconds. Only selected response headers are exposed. Non-2xx responses fail the node. Browser-local HTTP tests remain separate, use browser fetch/CORS rules, and do not use the server allow-list or server credential references.

This is a first guarded implementation, not a production security certification. Configure the smallest possible host allow-list and complete live integration, abuse, load and independent security testing before exposing it to untrusted users.

## Loop Over Items

The `loop` node processes a finite array without creating a graph cycle. Set `config.listField` to a nested path such as `items` or `data.records`; the default is `items`. `config.maxItems` defaults to 20 and must be an integer from 1 to 100. A non-array source or a list beyond the configured maximum fails the node before fan-out. An empty array produces no downstream node runs.

For each array member, each outgoing connection receives a separate downstream task. If an item is an object, its fields are available directly on that task input; the original item is also available at `item`. The runtime adds zero-based `itemIndex`, `itemCount`, and `loop: { field, index, count }`. The ordinary execution step budget still applies, so a loop with many downstream nodes can fail the overall run budget even when under its item limit. This node does not implement arbitrary back-edges, durable iteration state or parallel join semantics.

## Execution limitations
The queue worker supports Manual Trigger, Webhook Trigger, Schedule Trigger, Edit Fields, IF, Merge, bounded Loop Over Items, Wait, Log/Output and guarded server HTTPS Request nodes. HTTP calls require `HTTP_ALLOWED_HOSTS`; all other hostnames are rejected. Loop Over Items reads an array at `config.listField` (default `items`), rejects lists larger than `config.maxItems` (default 20, hard cap 100), and fans each item into the connected downstream nodes with `item`, `itemIndex`, `itemCount` and `loop.index/count` metadata. This is a bounded fan-out node, not support for arbitrary graph cycles. Durable wait/resume, general loop feedback and human approval are not implemented. Queue retries are limited to the worker job policy; they are not a substitute for idempotent workflow design.

## Production hardening still required
Password reset, MFA/SSO, account verification, session revocation, member invite/role administration, tenant security testing, credential rotation, backup/restore validation, retention/deletion workflows, audit coverage tests, egress allow-list governance, live HTTP/security testing, observability, rate-limit tuning and API/client integration remain before production use.
