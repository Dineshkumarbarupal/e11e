# e11e Flow

Original workflow automation prototype. This is an early scaffold, not n8n feature parity or enterprise-ready software.

## Stack direction
- UI: React + TypeScript + Vite + @xyflow/react for a future visual workflow canvas.
- API: Node.js + TypeScript + Fastify.
- Persistence: PostgreSQL.
- Queue: Redis + BullMQ workers.
- Security: KMS/Vault-backed secret encryption, RBAC, audit logs, rate limits and sandboxed execution.

## Directory layout
The requested `26.00.00/theme/AppName_Basic/User/` theme structure is reserved for UI assets. `25.00.00/` is reserved for compatibility assets. Backend, tests and docs live in root-level folders.

## Run
Node.js 20+; `npm install`; `npm run dev`; `npm run build`.

The current interface is a static demo with sample data. Workflow execution, persistence, authentication and integrations are not implemented yet.

See `docs/ROADMAP.md`, `docs/ARCHITECTURE.md` and `docs/DEPLOYMENT.md`.
