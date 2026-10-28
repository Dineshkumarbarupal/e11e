# Deployment guide (demo vs full stack)

Free-tier availability, resource limits and usage rules change. Review each provider's current terms before committing data or relying on always-on operation.

## 1. Free static demo: Cloudflare Pages
The current Vite frontend is static and is the simplest free showcase target.
1. Connect `Dineshkumarbarupal/e11e` in Cloudflare Pages.
2. Build command: `npm run build`
3. Build output: `dist`
4. Deploy the generated `pages.dev` URL.

Cloudflare's Pages docs currently list a Free plan with 500 builds/month and one concurrent build. See [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/).

This only deploys the frontend. It does not start the API, PostgreSQL, Redis, worker or cron scheduler.

## 2. Full-stack sandbox: Render + managed services
Render documents free web services, static sites, Postgres and Key Value, but warns that free instances are for testing/hobby use rather than production. Free web services spin down after 15 minutes idle and can take about a minute to resume. Free Postgres is limited to 1 GB and expires 30 days after creation; free Key Value is in-memory and loses data on restart. See [Render free service limits](https://render.com/docs/free).

For a temporary test environment only, you can deploy the API as a Node web service, create a Redis-compatible instance, configure secrets in the host environment and run a separate worker process if the plan supports it. Verify outbound connections/resource limits. Do not rely on a free database for durable workflow history.

## 3. Potential managed components
- [Supabase](https://supabase.com/pricing): its Free projects currently include 500 MB database storage and can pause after a week of low activity. Validate the current plans and DB connection guidance before use.
- [Upstash Redis](https://upstash.com/pricing/redis): its Free Redis tier currently lists 256 MB and 500K monthly commands. Queue workload may exceed this; monitor quotas.
- A local Docker deployment is useful for development, but it is not operationally free: backup, uptime, networking and maintenance remain your responsibility.

## Recommendation
- **Free UI demo:** Cloudflare Pages.
- **Short-lived end-to-end test:** a free Node service plus temporary PostgreSQL/Redis resources where available, with synthetic data only.
- **Enterprise deployment:** paid monitored runtime(s), private networking, managed PostgreSQL/Redis, dedicated secret/KMS management, backups, alerts, log/metric retention, incident handling and recovery tests.

## Do not deploy publicly yet
The server package is an implementation foundation, not enterprise-ready. Before real users or business credentials, integrate the frontend with the API and complete the security gaps listed in [SECURITY.md](../SECURITY.md). Also implement the full workflow semantics, outbound HTTP security, testing and operational controls.
