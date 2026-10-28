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

## Execution limitations
The queue worker currently supports Manual Trigger, Edit Fields, IF, Merge, Wait and Log/Output. It rejects server-side HTTP nodes by design until outbound egress/SSRF protection and credential-reference support are implemented. Loop semantics, retries at the node level and human approval are not implemented. Queue retries are limited to the worker job policy; they are not a substitute for idempotent workflow design.

## Production hardening still required
Password reset, MFA/SSO, account verification, session revocation, member invite/role administration, tenant security testing, credential rotation, backup/restore validation, retention/deletion workflows, audit coverage tests, egress controls, observability, rate-limit tuning and API/client integration remain before production use.
