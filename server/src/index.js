import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { redis } from "./redis.js";
import { Queue } from "bullmq";

const queue = new Queue("workflow-executions", { connection: redis });
const app = await buildApp({ queue });
try {
  await redis.connect();
  await pool.query("SELECT 1");
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(`e11e Flow API listening on ${config.HOST}:${config.PORT}`);
} catch (error) {
  app.log.error({ err: error }, "Startup failed");
  await app.close().catch(() => {});
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
