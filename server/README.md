# e11e Flow API and worker

Requires Node.js 24 LTS or newer.

This package is a development foundation and is not a production-hardened public automation service.

## Local setup with Docker Compose
1. Copy `.env.example` to `.env` in this directory.
2. Replace `JWT_SECRET` with at least 32 random characters and `CREDENTIAL_ENCRYPTION_KEY_HEX` with exactly 64 hex characters (32 random bytes).
3. From repository root run `docker compose up --build`.

The Compose stack starts PostgreSQL, Redis, the API (port 8787 bound to localhost), a separate background worker and a UTC cron scheduler. The API startup applies the database migration. This is for local development only; sample Compose database password must be replaced for any shared environment.

## Run without Docker
Provide a PostgreSQL database and Redis instance, configure `.env`, then from repository root:
```bash
npm install --prefix server
npm run server:migrate
npm run server:dev
npm run server:worker
npm run server:scheduler
``

The static browser frontend runs separately with the root commands documented in [README](../README.md).
