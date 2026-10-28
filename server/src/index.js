import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { redis } from "./redis.js";
import { Queue } from "bullmq";

let queue;
let app;
try {
  // Establish database and Redis connectivity before constructing BullMQ objects
  // that share the Redis connection.
  await redis.connect();
  await pool.query("SELECT 1");
  await redis.ping();
  queue = new Queue("workflow-executions", { connection: redis });
  app = await buildApp({ queue });
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(`e11e Flow API listening on ${config.HOST}:${config.PORT}`);
} catch (error) {
  app?.log?.error({ err: error }, "Startup failed");
  if (app) await app.close().catch(() => {});
  else if (queue) await queue.close().catch(() => {});
  await redis.quit().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
}
const shutdown = async signal => {
  app.log.info(`Received ${signal}; shutting down.`);
  await app.close();
  await redis.quit().catch(() => {});
  await pool.end();
  process.exit(0);
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
