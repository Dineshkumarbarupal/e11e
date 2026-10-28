import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
import { pool } from "./db.js";
import { collectDueScheduleNodes } from "./scheduler-core.js";

const POLL_INTERVAL_MS = 15000;
const QUEUE_NAME = "workflow-executions";
const SCHEDULER_LOCK_CLASS = 72819401;
const SCHEDULER_LOCK_KEY = 1;

const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
});
const queue = new Queue(QUEUE_NAME, { connection });
const invalidCronWarnings = new Set();
let pollInFlight = null;
let stopping = false;
let timer = null;

function logError(message, error) {
  console.error("[e11e scheduler] " + message + (error && error.message ? ": " + error.message : ""));
}

async function recordDueSchedule(trigger) {
  const client = await pool.connect();
  const executionId = randomUUID();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const claimed = await client.query(
      "INSERT INTO schedule_trigger_state(workspace_id,workflow_id,node_id,last_fired_slot) " +
      "VALUES($1,$2,$3,$4::timestamptz) " +
      "ON CONFLICT(workspace_id,workflow_id,node_id) DO UPDATE " +
      "SET last_fired_slot=EXCLUDED.last_fired_slot,updated_at=now() " +
      "WHERE schedule_trigger_state.last_fired_slot < EXCLUDED.last_fired_slot " +
      "RETURNING node_id",
      [trigger.workspaceId, trigger.workflowId, trigger.nodeId, trigger.slot]
    );
    if (!claimed.rowCount) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return false;
    }
    await client.query(
      "INSERT INTO executions(id,workspace_id,workflow_id,status,input,trigger_type,trigger_node_id) " +
      "VALUES($1,$2,$3,'queued','{}'::jsonb,'schedule',$4)",
      [executionId, trigger.workspaceId, trigger.workflowId, trigger.nodeId]
    );
    await client.query("COMMIT");
    transactionOpen = false;
    console.info("[e11e scheduler] queued schedule slot " + trigger.slot + " for workflow " + trigger.workflowId + " node " + trigger.nodeId);
    return true;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    logError("could not record schedule slot " + trigger.key, error);
    return false;
  } finally {
    client.release();
  }
}

async function enqueuePendingExecutions() {
  const result = await pool.query(
    "SELECT id FROM executions WHERE status='queued' AND trigger_type='schedule' ORDER BY queued_at ASC LIMIT 200"
  );
  for (const execution of result.rows) {
    try {
      await queue.add("execute-workflow", { executionId: execution.id }, {
        jobId: execution.id,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 500,
        removeOnFail: 1000
      });
    } catch (error) {
      // Keep the Postgres execution queued. A later scheduler poll retries enqueueing it.
      logError("could not enqueue scheduled execution " + execution.id + "; it will be retried", error);
      break;
    }
  }
}

async function pollSchedules() {
  const now = new Date();
  const result = await pool.query(
    "SELECT id,workspace_id,active,definition FROM workflows WHERE active=true ORDER BY updated_at ASC"
  );
  const selection = collectDueScheduleNodes(result.rows, now);

  for (const invalid of selection.invalid) {
    const warningKey = invalid.key + ":" + invalid.expression;
    if (invalidCronWarnings.has(warningKey)) continue;
    invalidCronWarnings.add(warningKey);
    logError("invalid cron expression for workflow " + invalid.workflowId + " node " + invalid.nodeId);
  }

  for (const trigger of selection.due) await recordDueSchedule(trigger);
  await enqueuePendingExecutions();
}

function tick() {
  if (stopping || pollInFlight) return pollInFlight;
  pollInFlight = pollSchedules()
    .catch(error => logError("poll failed; the next cycle will retry", error))
    .finally(() => { pollInFlight = null; });
  return pollInFlight;
}

async function closeResources(lockClient, releaseLock) {
  await queue.close().catch(() => {});
  await connection.quit().catch(() => {});
  if (releaseLock) await lockClient.query("SELECT pg_advisory_unlock($1,$2)", [SCHEDULER_LOCK_CLASS, SCHEDULER_LOCK_KEY]).catch(() => {});
  lockClient.release();
  await pool.end().catch(() => {});
}

async function main() {
  const lockClient = await pool.connect();
  const lockResult = await lockClient.query(
    "SELECT pg_try_advisory_lock($1,$2) AS locked",
    [SCHEDULER_LOCK_CLASS, SCHEDULER_LOCK_KEY]
  );
  if (!lockResult.rows[0]?.locked) {
    logError("another scheduler instance holds the database lock; this instance will exit");
    await closeResources(lockClient, false);
    process.exitCode = 1;
    return;
  }

  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    if (timer) clearInterval(timer);
    if (pollInFlight) await pollInFlight;
    console.info("[e11e scheduler] received " + signal + "; shutting down");
    await closeResources(lockClient, true);
  }

  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  await tick();
  timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.info("[e11e scheduler] running with " + POLL_INTERVAL_MS + "ms polling; schedules use UTC");
}

main().catch(async error => {
  logError("startup failed", error);
  await queue.close().catch(() => {});
  await connection.quit().catch(() => {});
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
