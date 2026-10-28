import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-jwt-secret-that-is-long-enough-for-validation";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.CREDENTIAL_ENCRYPTION_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.HTTP_ALLOWED_HOSTS = "";

const { buildApp } = await import("../src/app.js");
const { encryptSecret } = await import("../src/crypto.js");
const { createWebhookSignature } = await import("../src/webhook-signature.js");

const workflowId = "123e4567-e89b-42d3-a456-426614174000";
const workspaceId = "223e4567-e89b-42d3-a456-426614174000";
const token = "test-webhook-token-that-is-more-than-32-chars";
const tokenHash = createHash("sha256").update(token).digest("hex");
const eventKey = (ws, wf, nodeId, dedupeKey) => [ws, wf, nodeId, dedupeKey].join("|");

function makePool({ requireSignature = false, signatureSecretEncrypted = null } = {}) {
  const executions = new Map();
  const dedupeIndex = new Map();
  const pool = {
    executions,
    dedupeIndex,
    async query(sql, params = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (statement.startsWith("SELECT t.workspace_id,t.workflow_id,t.node_id,t.signature_secret_encrypted,w.active,w.definition FROM webhook_tokens")) {
        if (params[0] !== workflowId || params[1] !== "hook" || params[2] !== tokenHash) return { rows: [] };
        return {
          rows: [{
            workspace_id: workspaceId,
            workflow_id: workflowId,
            node_id: "hook",
            signature_secret_encrypted: signatureSecretEncrypted,
            active: true,
            definition: { nodes: [{ id: "hook", type: "webhook", name: "Webhook Trigger", config: { requireSignature } }] }
          }]
        };
      }
      if (statement.startsWith("INSERT INTO executions") && statement.includes("dedupe_key")) {
        const [id, ws, wf, input, nodeId, dedupeKey] = params;
        const key = dedupeKey ? eventKey(ws, wf, nodeId, dedupeKey) : null;
        if (key && dedupeIndex.has(key)) return { rows: [] };
        const row = { id, workspace_id: ws, workflow_id: wf, input, trigger_node_id: nodeId, trigger_type: "webhook", dedupe_key: dedupeKey, status: "queued" };
        executions.set(id, row);
        if (key) dedupeIndex.set(key, id);
        return { rows: [{ id, status: "queued" }] };
      }
      if (statement.startsWith("SELECT id,status FROM executions WHERE workspace_id=")) {
        const [ws, wf, nodeId, dedupeKey] = params;
        const key = eventKey(ws, wf, nodeId, dedupeKey);
        const id = dedupeIndex.get(key);
        const row = id ? executions.get(id) : null;
        return { rows: row ? [{ id: row.id, status: row.status }] : [] };
      }
      if (statement.startsWith("UPDATE executions SET status='error',dedupe_key=NULL")) {
        const row = executions.get(params[0]);
        if (row) {
          if (row.dedupe_key) dedupeIndex.delete(eventKey(row.workspace_id, row.workflow_id, row.trigger_node_id, row.dedupe_key));
          row.status = "error";
          row.dedupe_key = null;
        }
        return { rows: [] };
      }
      throw new Error("Unexpected SQL in webhook test: " + statement);
    }
  };
  return pool;
}

function makeQueue({ failFirst = false } = {}) {
  let fail = failFirst;
  return {
    addCalls: [],
    async add(name, data, options) {
      this.addCalls.push({ name, data, options });
      if (fail) {
        fail = false;
        throw new Error("Simulated Redis outage");
      }
      return { id: options.jobId };
    },
    async close() {}
  };
}

async function injectWebhook(app, { headers = {}, body = { event: "created" } } = {}) {
  return app.inject({
    method: "POST",
    url: "/api/webhooks/" + workflowId + "/hook",
    headers: { "x-e11e-webhook-token": token, ...headers },
    payload: body
  });
}

test("webhook event retries return the original execution without queueing twice", async () => {
  const pool = makePool();
  const queue = makeQueue();
  const app = await buildApp({ pool, queue });
  try {
    const headers = { "x-e11e-event-id": "evt_order_123" };
    const first = await injectWebhook(app, { headers });
    const second = await injectWebhook(app, { headers, body: { event: "different-retry-payload" } });
    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 200);
    assert.equal(queue.addCalls.length, 1);
    assert.equal(pool.executions.size, 1);
    const firstBody = first.json();
    const secondBody = second.json();
    assert.equal(secondBody.execution.duplicate, true);
    assert.equal(secondBody.execution.id, firstBody.execution.id);
    assert.equal(secondBody.execution.status, "queued");
  } finally {
    await app.close();
  }
});

test("different webhook event IDs create different executions", async () => {
  const pool = makePool();
  const queue = makeQueue();
  const app = await buildApp({ pool, queue });
  try {
    const first = await injectWebhook(app, { headers: { "x-e11e-event-id": "evt_one" } });
    const second = await injectWebhook(app, { headers: { "x-e11e-event-id": "evt_two" } });
    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.notEqual(first.json().execution.id, second.json().execution.id);
    assert.equal(queue.addCalls.length, 2);
    assert.equal(pool.executions.size, 2);
  } finally {
    await app.close();
  }
});

test("webhook event IDs are optional for compatibility with existing senders", async () => {
  const pool = makePool();
  const queue = makeQueue();
  const app = await buildApp({ pool, queue });
  try {
    const first = await injectWebhook(app);
    const second = await injectWebhook(app);
    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.notEqual(first.json().execution.id, second.json().execution.id);
    assert.equal(queue.addCalls.length, 2);
  } finally {
    await app.close();
  }
});

test("invalid or conflicting webhook event IDs fail before execution is inserted", async () => {
  const pool = makePool();
  const queue = makeQueue();
  const app = await buildApp({ pool, queue });
  try {
    const invalid = await injectWebhook(app, { headers: { "x-e11e-event-id": "event with spaces" } });
    const conflict = await injectWebhook(app, {
      headers: { "x-e11e-event-id": "event-a", "idempotency-key": "event-b" }
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(conflict.statusCode, 400);
    assert.equal(pool.executions.size, 0);
    assert.equal(queue.addCalls.length, 0);
  } finally {
    await app.close();
  }
});

test("failed queue insertion releases the dedupe key so a provider retry can succeed", async () => {
  const pool = makePool();
  const queue = makeQueue({ failFirst: true });
  const app = await buildApp({ pool, queue });
  try {
    const headers = { "idempotency-key": "evt_retry_after_outage" };
    const failed = await injectWebhook(app, { headers });
    const retried = await injectWebhook(app, { headers });
    assert.equal(failed.statusCode, 503);
    assert.equal(retried.statusCode, 202);
    assert.notEqual(failed.json().execution?.id, retried.json().execution.id);
    assert.equal(queue.addCalls.length, 2);
    assert.equal(pool.executions.size, 2);
    assert.equal([...pool.executions.values()][0].dedupe_key, null);
  } finally {
    await app.close();
  }
});


test("CORS preflight allows webhook event-ID and idempotency headers", async () => {
  const pool = makePool();
  const queue = makeQueue();
  const app = await buildApp({ pool, queue });
  try {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/webhooks/" + workflowId + "/hook",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-e11e-webhook-token,x-e11e-event-id,idempotency-key,x-e11e-webhook-signature,x-e11e-webhook-timestamp"
      }
    });
    assert.equal(response.statusCode, 204);
    assert.match(response.headers["access-control-allow-headers"], /x-e11e-event-id/i);
    assert.match(response.headers["access-control-allow-headers"], /idempotency-key/i);
    assert.match(response.headers["access-control-allow-headers"], /x-e11e-webhook-signature/i);
    assert.match(response.headers["access-control-allow-headers"], /x-e11e-webhook-timestamp/i);
  } finally {
    await app.close();
  }
});


test("signature-required webhook accepts a valid HMAC and timestamp", async () => {
  const signatureSecret = "fixture-signing-secret-for-e11e-tests-32-bytes";
  const pool = makePool({ requireSignature: true, signatureSecretEncrypted: encryptSecret({ secret: signatureSecret }) });
  const queue = makeQueue();
  const app = await buildApp({ pool, queue });
  try {
    const body = { event: "created", item: { id: 123, name: "Ada" } };
    const eventId = "evt_signed_123";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createWebhookSignature(signatureSecret, timestamp, body, eventId);
    const response = await injectWebhook(app, {
      headers: {
        "x-e11e-webhook-timestamp": timestamp,
        "x-e11e-webhook-signature": signature,
        "x-e11e-event-id": eventId
      },
      body
    });
    assert.equal(response.statusCode, 202);
    assert.equal(queue.addCalls.length, 1);
    assert.equal(pool.executions.size, 1);
  } finally {
    await app.close();
  }
});

test("signature-required webhook rejects missing, stale and tampered signatures before queueing", async () => {
  const signatureSecret = "fixture-signing-secret-for-e11e-tests-32-bytes";
  const pool = makePool({ requireSignature: true, signatureSecretEncrypted: encryptSecret({ secret: signatureSecret }) });
  const queue = makeQueue();
  const app = await buildApp({ pool, queue });
  try {
    const body = { event: "created", value: 7 };
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    const eventId = "evt_signed_missing";
    const signature = createWebhookSignature(signatureSecret, timestamp, body, eventId);
    const missing = await injectWebhook(app, {
      headers: { "x-e11e-event-id": eventId },
      body
    });
    const noEventId = await injectWebhook(app, { body });
    const staleTimestamp = String(Math.floor(now / 1000) - 301);
    const staleEventId = "evt_signed_stale";
    const staleSignature = createWebhookSignature(signatureSecret, staleTimestamp, body, staleEventId);
    const stale = await injectWebhook(app, {
      headers: {
        "x-e11e-event-id": staleEventId,
        "x-e11e-webhook-timestamp": staleTimestamp,
        "x-e11e-webhook-signature": staleSignature
      },
      body
    });
    const tamperedEventId = "evt_signed_tampered";
    const tamperedSignature = createWebhookSignature(signatureSecret, timestamp, body, tamperedEventId);
    const tampered = await injectWebhook(app, {
      headers: {
        "x-e11e-event-id": tamperedEventId,
        "x-e11e-webhook-timestamp": timestamp,
        "x-e11e-webhook-signature": tamperedSignature
      },
      body: { event: "changed", value: 7 }
    });
    const signatureReusedForOtherId = await injectWebhook(app, {
      headers: {
        "x-e11e-event-id": "evt_different_id",
        "x-e11e-webhook-timestamp": timestamp,
        "x-e11e-webhook-signature": signature
      },
      body
    });
    assert.equal(missing.statusCode, 401);
    assert.equal(noEventId.statusCode, 400);
    assert.equal(stale.statusCode, 401);
    assert.equal(tampered.statusCode, 401);
    assert.equal(signatureReusedForOtherId.statusCode, 401);
    assert.equal(queue.addCalls.length, 0);
    assert.equal(pool.executions.size, 0);
  } finally {
    await app.close();
  }
});

test("signature-required webhook returns configuration error if signing secret is missing", async () => {
  const pool = makePool({ requireSignature: true });
  const queue = makeQueue();
  const app = await buildApp({ pool, queue });
  try {
    const response = await injectWebhook(app);
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error, /signature secret is not configured/i);
    assert.equal(queue.addCalls.length, 0);
  } finally {
    await app.close();
  }
});
