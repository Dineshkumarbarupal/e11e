import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-jwt-secret-that-is-long-enough-for-validation";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.CREDENTIAL_ENCRYPTION_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.HTTP_ALLOWED_HOSTS = "";

const { buildApp } = await import("../src/app.js");

const workspaceId = "223e4567-e89b-42d3-a456-426614174000";
const userId = "323e4567-e89b-42d3-a456-426614174000";

function makePool(initialStatus = "queued", role = "owner") {
  const row = initialStatus === null ? null : {
    id: "423e4567-e89b-42d3-a456-426614174000",
    workspace_id: workspaceId,
    status: initialStatus,
    trigger_type: "manual"
  };
  const auditRows = [];
  return {
    row,
    auditRows,
    async query(sql, params = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (statement.startsWith("SELECT role FROM workspace_members")) return { rows: [{ role }] };
      if (statement.startsWith("UPDATE executions SET status='cancelled'")) {
        const [, id] = params;
        if (!row || row.id !== id || !["queued", "running"].includes(row.status)) return { rows: [] };
        row.status = "cancelled";
        row.error = "Cancelled by user";
        return { rows: [{ id: row.id, status: row.status }] };
      }
      if (statement.startsWith("SELECT id,status FROM executions WHERE workspace_id=$1 AND id=$2")) {
        const [, id] = params;
        return row && row.id === id ? { rows: [{ id: row.id, status: row.status }] } : { rows: [] };
      }
      if (statement.startsWith("INSERT INTO audit_logs")) {
        auditRows.push({ sql: statement, params });
        return { rows: [] };
      }
      throw new Error("Unexpected SQL in cancellation test: " + statement);
    }
  };
}

function makeQueue({ state = "waiting", jobExists = true } = {}) {
  let removeCalls = 0;
  const queue = {
    async getJob() {
      if (!jobExists) return null;
      return {
        async getState() { return state; },
        async remove() { removeCalls += 1; }
      };
    },
    async close() {}
  };
  return { queue, get removeCalls() { return removeCalls; } };
}

async function withApp({ status = "queued", role = "owner", queueState = "waiting", jobExists = true } = {}, fn) {
  const pool = makePool(status, role);
  const queue = makeQueue({ state: queueState, jobExists });
  const app = await buildApp({ pool, queue });
  const token = app.jwt.sign({ sub: userId, email: "user@example.test" });
  try {
    await fn({ app, pool, queue, token });
  } finally {
    await app.close();
  }
}

async function cancel(app, token, id = "423e4567-e89b-42d3-a456-426614174000") {
  return app.inject({
    method: "POST",
    url: "/api/workspaces/" + workspaceId + "/executions/" + id + "/cancel",
    headers: token ? { authorization: "Bearer " + token } : {}
  });
}

test("queued execution is cancelled and removed from the pending queue", async () => {
  await withApp({ status: "queued", queueState: "waiting" }, async ({ app, pool, queue, token }) => {
    const response = await cancel(app, token);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().execution, {
      id: pool.row.id, status: "cancelled", removedFromQueue: true
    });
    assert.equal(pool.row.status, "cancelled");
    assert.equal(queue.removeCalls, 1);
    assert.equal(pool.auditRows.length, 1);
    assert.equal(pool.auditRows[0].params[3], "execution.cancel");
  });
});

test("running execution is marked cancelled without trying to remove the active job", async () => {
  await withApp({ status: "running", queueState: "active" }, async ({ app, pool, queue, token }) => {
    const response = await cancel(app, token);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().execution.status, "cancelled");
    assert.equal(response.json().execution.removedFromQueue, false);
    assert.equal(pool.row.status, "cancelled");
    assert.equal(queue.removeCalls, 0);
  });
});

test("cancelling an already-cancelled execution is idempotent", async () => {
  await withApp({ status: "cancelled" }, async ({ app, pool, queue, token }) => {
    const response = await cancel(app, token);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().execution.alreadyCancelled, true);
    assert.equal(pool.auditRows.length, 0);
    assert.equal(queue.removeCalls, 0);
  });
});

test("finished executions cannot be cancelled", async () => {
  await withApp({ status: "success" }, async ({ app, pool, queue, token }) => {
    const response = await cancel(app, token);
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().execution.status, "success");
    assert.equal(pool.row.status, "success");
    assert.equal(pool.auditRows.length, 0);
    assert.equal(queue.removeCalls, 0);
  });
});

test("execution cancellation is workspace-scoped and returns 404 for missing rows", async () => {
  await withApp({ status: null }, async ({ app, pool, queue, token }) => {
    const response = await cancel(app, token);
    assert.equal(response.statusCode, 404);
    assert.equal(pool.auditRows.length, 0);
    assert.equal(queue.removeCalls, 0);
  });
});

test("execution cancellation requires authentication and a writable workspace role", async () => {
  await withApp({ status: "queued" }, async ({ app, token }) => {
    const noAuth = await cancel(app, null);
    assert.equal(noAuth.statusCode, 401);
    const viewer = await cancel(app, token);
    assert.equal(viewer.statusCode, 200);
  });
});

test("queue removal errors do not undo the authoritative database cancellation", async () => {
  const pool = makePool("queued");
  const queue = {
    async getJob() {
      return { async getState() { return "waiting"; }, async remove() { throw new Error("job already moved"); } };
    },
    async close() {}
  };
  const app = await buildApp({ pool, queue });
  const token = app.jwt.sign({ sub: userId, email: "user@example.test" });
  try {
    const response = await cancel(app, token);
    assert.equal(response.statusCode, 200);
    assert.equal(pool.row.status, "cancelled");
    assert.equal(response.json().execution.removedFromQueue, false);
    assert.equal(pool.auditRows.length, 1);
  } finally {
    await app.close();
  }
});
