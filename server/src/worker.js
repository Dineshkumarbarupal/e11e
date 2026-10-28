import { Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
import { pool } from "./db.js";
import { executeWorkflowDefinition } from "./executor.js";
import { decryptSecret } from "./crypto.js";
import { claimExecution } from "./execution-claims.js";

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
const concurrency = Math.min(Math.max(Number(process.env.WORKER_CONCURRENCY) || 3, 1), 16);
const worker = new Worker("workflow-executions", async job => {
  const { executionId } = job.data;
  const result = await pool.query(
    "SELECT e.id,e.workspace_id,e.workflow_id,e.input,e.trigger_type,e.trigger_node_id,e.status,w.definition FROM executions e JOIN workflows w ON w.id=e.workflow_id AND w.workspace_id=e.workspace_id WHERE e.id=$1",
    [executionId]
  );
  const record = result.rows[0];
  if (!record) throw new Error("Execution or workflow record not found.");
  const claim = await claimExecution(pool, executionId);
  if (!claim.claimed) {
    console.info("Skipping duplicate execution job:", executionId, "current status:", claim.status);
    return { status: claim.status, skipped: true };
  }
  try {
    const definition = typeof record.definition === "string" ? JSON.parse(record.definition) : record.definition;
    const run = await executeWorkflowDefinition(definition, {
      input: record.input || {},
      maxSteps: 100,
      triggerNodeId: record.trigger_node_id || undefined,
      allowedHosts: config.HTTP_ALLOWED_HOSTS,
      shouldCancel: async () => {
        const state = await pool.query("SELECT status FROM executions WHERE id=$1", [executionId]);
        return state.rows[0]?.status === "cancelled";
      },
      resolveCredential: async credentialId => {
        const result = await pool.query(
          "SELECT encrypted_payload FROM credentials WHERE workspace_id=$1 AND id=$2",
          [record.workspace_id, credentialId]
        );
        const credential = result.rows[0];
        if (!credential) throw new Error("Credential was not found in this execution workspace.");
        const payload = typeof credential.encrypted_payload === "string" ? JSON.parse(credential.encrypted_payload) : credential.encrypted_payload;
        return decryptSecret(payload);
      }
    });
    const finished = await pool.query("UPDATE executions SET status='success',output=$2::jsonb,node_runs=$3::jsonb,finished_at=now(),error=NULL WHERE id=$1 AND status='running' RETURNING id", [executionId, JSON.stringify(run.output), JSON.stringify(run.nodeRuns)]);
    if (!finished.rows[0]) {
      const latest = await pool.query("SELECT status FROM executions WHERE id=$1", [executionId]);
      if (latest.rows[0]?.status === "cancelled") {
        await pool.query(
          "UPDATE executions SET node_runs=$2::jsonb,error=COALESCE(error,'Cancelled by user'),finished_at=COALESCE(finished_at,now()) WHERE id=$1 AND status='cancelled'",
          [executionId, JSON.stringify(run.nodeRuns)]
        );
      }
      return { status: latest.rows[0]?.status || "unknown", skipped: true };
    }
    return { status: "success", nodeCount: run.nodeRuns.length };
  } catch (error) {
    const nodeRuns = error.nodeRuns || [];
    const latest = await pool.query("SELECT status FROM executions WHERE id=$1", [executionId]);
    if (error.cancelled === true || latest.rows[0]?.status === "cancelled") {
      await pool.query("UPDATE executions SET status='cancelled',node_runs=$2::jsonb,error='Cancelled by user',finished_at=COALESCE(finished_at,now()) WHERE id=$1 AND status IN ('running','cancelled')", [executionId, JSON.stringify(nodeRuns)]);
      console.info("Workflow cancellation observed:", executionId);
      return { status: "cancelled", nodeCount: nodeRuns.length };
    }
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
    await pool.query("UPDATE executions SET status='error',node_runs=$2::jsonb,error=$3,finished_at=now() WHERE id=$1 AND status='running'", [executionId, JSON.stringify(nodeRuns), message]);
    throw error;
  }
}, { connection, concurrency, limiter: { max: 30, duration: 60000 } });

worker.on("completed", job => console.info("Workflow execution completed:", job.id));
worker.on("failed", (job, error) => console.error("Workflow execution failed:", job?.id, error.message));
console.info(`e11e Flow worker started (concurrency ${concurrency}).`);

async function shutdown(signal) {
  console.info(`Worker received ${signal}; shutting down.`);
  await worker.close();
  await connection.quit().catch(() => {});
  await pool.end();
  process.exit(0);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
