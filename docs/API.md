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
- `DELETE /api/workspaces/:workspaceId/credentials/:credentialId`
- `GET /api/workspaces/:workspaceId/audit-logs` (owner/admin only).


## Token-protected webhook triggers

Add a Webhook Trigger node to a workflow, sign in to the frontend, and use the node inspector's Generate / rotate endpoint token action. The token is returned once and only its SHA-256 hash is stored in PostgreSQL. Copy it into your external event source's secret header configuration.

- Create or rotate a node token: POST /api/workspaces/:workspaceId/workflows/:workflowId/nodes/:nodeId/webhook-token (JWT required).
- Trigger execution: POST /api/webhooks/:workflowId/:nodeId with the header x-e11e-webhook-token: TOKEN and a JSON request body.
- A public webhook returns 202 with an execution id after adding a job to Redis/BullMQ.
- The workflow must be saved and active on the server. If it was edited in the browser, sync it after toggling the Active flag.
- Token rotation invalidates the previous token. The server redacts webhook tokens from request logs.
- The route has the API body-size and rate limits; production should add provider-specific signature verification, per-webhook quotas, secret rotation policy and end-to-end abuse tests.
- Browser callers must use an origin configured in `CORS_ORIGINS`; the API CORS allow-list includes `x-e11e-webhook-token` for the webhook preflight.

## Execution limitations
The queue worker currently supports Manual Trigger, Webhook Trigger, Edit Fields, IF, Merge, Wait and Log/Output. It rejects server-side HTTP nodes by design until outbound egress/SSRF protection and credential-reference support are implemented. Loop semantics, retries at the node level and human approval are not implemented. Queue retries are limited to the worker job policy; they are not a substitute for idempotent workflow design.

## Production hardening still required
Password reset, MFA/SSO, account verification, session revocation, member invite/role administration, tenant security testing, credential rotation, backup/restore validation, retention/deletion workflows, audit coverage tests, egress controls, observability, rate-limit tuning and API/client integration remain before production use.
