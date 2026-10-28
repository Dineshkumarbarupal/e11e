# Deployment options

## Static demo
Use Cloudflare Pages or GitHub Pages for the Vite static build (output directory `dist`, build command `npm run build`) where supported. Verify current provider free-tier terms before deploying.

## Future full-stack app
The API and worker need a Node-compatible service; PostgreSQL can be managed separately and Redis is required when distributed queue execution is added. Free tiers can sleep, have resource limits, or change, so do not assume always-on free production hosting.

## Recommendation
Deploy only the static demo for a free showcase. Do not expose this scaffold as a public automation server: it currently has no auth, persistence, webhook security or sandboxing. Enterprise production requires monitored hosting, private networking, backups, secrets management, alerts and tested disaster recovery.
