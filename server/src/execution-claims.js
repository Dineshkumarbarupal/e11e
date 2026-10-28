/**
 * Atomically claim an execution before running any workflow side effects.
 * Failed executions remain retryable by BullMQ; already-running or finished
 * rows are returned as non-claims so duplicate jobs cannot execute twice.
 */
export async function claimExecution(db, executionId) {
  if (!db || typeof db.query !== "function") throw new Error("A database query interface is required.");
  if (typeof executionId !== "string" || !executionId) throw new Error("An execution ID is required.");

  const claimed = await db.query(
    "UPDATE executions SET status='running',started_at=COALESCE(started_at,now()),error=NULL " +
    "WHERE id=$1 AND status IN ('queued','error') RETURNING id,status",
    [executionId]
  );
  if (claimed.rows?.[0]) return { claimed: true, status: "running" };

  const current = await db.query("SELECT status FROM executions WHERE id=$1", [executionId]);
  const status = current.rows?.[0]?.status;
  if (!status) throw new Error("Execution record not found while claiming: " + executionId);
  if (status === "queued" || status === "error") {
    throw new Error("Execution could not be atomically claimed from state: " + status);
  }
  return { claimed: false, status };
}
