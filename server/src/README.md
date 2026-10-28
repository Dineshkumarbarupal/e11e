# Server source layout

- `config.js`: validated environment variables
- `db.js`: PostgreSQL pool
- `redis.js`: Redis connection
- `schemas.js`: Zod validation for workflow and auth request bodies
- `crypto.js`: AES-256-GCM encryption for credential payloads
- `app.js`: Fastify routes, auth, workspace membership checks and API validation
- `executor.js`: deliberately limited server worker execution semantics
- `index.js`: API process entry point and shutdown handling
- `worker.js`: BullMQ job worker
- `migrate.js`: SQL migration runner

Do not remove the server-side HTTP-node guard until outbound network filtering, redirect/DNS checks, credential-reference isolation and SSRF tests are implemented.
