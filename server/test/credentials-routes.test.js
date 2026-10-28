import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-jwt-secret-that-is-long-enough-for-validation";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.CREDENTIAL_ENCRYPTION_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.HTTP_ALLOWED_HOSTS = "";

const { buildApp } = await import("../src/app.js");
const { decryptSecret } = await import("../src/crypto.js");
const workspaceId = "223e4567-e89b-42d3-a456-426614174000";
const userId = "323e4567-e89b-42d3-a456-426614174000";
const credentialId = "423e4567-e89b-42d3-a456-426614174000";
const fixedTime = new Date("2026-10-28T10:00:00.000Z");

function makePool({ role = "owner", initialCredentials = [] } = {}) {
  const credentials = new Map(initialCredentials.map(item => [item.id, { ...item }]));
  const audits = [];
  return {
    credentials,
    audits,
    async query(sql, params = []) {
      const statement = String(sql).replace(/\s+/g, " ").trim();
      if (statement.startsWith("SELECT role FROM workspace_members")) return { rows: [{ role }], rowCount: 1 };

      if (statement.startsWith("SELECT id,name,service,created_at,updated_at FROM credentials WHERE workspace_id=$1")) {
        const rows = [...credentials.values()]
          .filter(item => item.workspace_id === params[0])
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .map(({ id, name, service, created_at, updated_at }) => ({ id, name, service, created_at, updated_at }));
        return { rows, rowCount: rows.length };
      }

      if (statement.startsWith("INSERT INTO credentials(")) {
        const [id, workspace_id, name, service, encryptedText, created_by] = params;
        if ([...credentials.values()].some(item => item.workspace_id === workspace_id && item.name === name)) {
          throw Object.assign(new Error("duplicate credential name"), { code: "23505" });
        }
        const row = {
          id, workspace_id, name, service, encrypted_payload: JSON.parse(encryptedText),
          created_by, created_at: fixedTime, updated_at: fixedTime
        };
        credentials.set(id, row);
        return { rows: [{ id, name, service, created_at: fixedTime, updated_at: fixedTime }], rowCount: 1 };
      }

      if (statement.startsWith("UPDATE credentials SET name=$3,service=$4,encrypted_payload=$5::jsonb,updated_at=now()")) {
        const [wsId, id, name, service, encryptedText] = params;
        const row = credentials.get(id);
        if (!row || row.workspace_id !== wsId) return { rows: [], rowCount: 0 };
        if ([...credentials.values()].some(item => item.id !== id && item.workspace_id === wsId && item.name === name)) {
          throw Object.assign(new Error("duplicate credential name"), { code: "23505" });
        }
        row.name = name;
        row.service = service;
        row.encrypted_payload = JSON.parse(encryptedText);
        row.updated_at = new Date("2026-10-28T10:05:00.000Z");
        return { rows: [{ id, name, service, created_at: row.created_at, updated_at: row.updated_at }], rowCount: 1 };
      }

      if (statement.startsWith("DELETE FROM credentials WHERE workspace_id=$1 AND id=$2")) {
        const [wsId, id] = params;
        const row = credentials.get(id);
        if (!row || row.workspace_id !== wsId) return { rows: [], rowCount: 0 };
        credentials.delete(id);
        return { rows: [{ id }], rowCount: 1 };
      }

      if (statement.startsWith("INSERT INTO audit_logs")) {
        audits.push({ statement, params });
        return { rows: [], rowCount: 1 };
      }

      throw new Error("Unexpected SQL in credential API test: " + statement);
    }
  };
}

async function withApp(options, fn) {
  const pool = makePool(options);
  const app = await buildApp({ pool });
  const token = app.jwt.sign({ sub: userId, email: "vault@example.test" });
  try {
    await fn({ app, pool, token });
  } finally {
    await app.close();
  }
}

const baseUrl = "/api/workspaces/" + workspaceId + "/credentials";
function request(app, token, method, suffix = "", payload) {
  return app.inject({
    method,
    url: baseUrl + suffix,
    headers: token ? { authorization: "Bearer " + token } : {},
    ...(payload === undefined ? {} : { payload })
  });
}

test("creating a credential stores ciphertext and returns metadata only", async () => {
  await withApp({}, async ({ app, pool, token }) => {
    const response = await request(app, token, "POST", "", {
      name: "Demo API",
      service: "example",
      secret: { token: "do-not-return-this-secret", nested: { apiKey: "private-key" } }
    });
    assert.equal(response.statusCode, 201);
    const result = response.json();
    assert.ok(result.credential.id);
    assert.equal("secret" in result.credential, false);
    assert.equal("encrypted_payload" in result.credential, false);
    assert.equal(pool.credentials.size, 1);
    const stored = [...pool.credentials.values()][0];
    assert.equal(JSON.stringify(stored.encrypted_payload).includes("do-not-return-this-secret"), false);
    assert.deepEqual(decryptSecret(stored.encrypted_payload), {
      token: "do-not-return-this-secret",
      nested: { apiKey: "private-key" }
    });
    assert.equal(pool.audits.length, 1);
    assert.ok(pool.audits[0].statement.includes("audit_logs"));
    assert.ok(pool.audits[0].params.includes("credential.create"));
  });
});

test("listing credentials never retrieves or returns secret payloads", async () => {
  const encryptedPayload = { version: 1, iv: "dGVzdGl2MTIzNDU2Nzg5MA==", tag: "dGVzdHRhZzEyMzQ1Ng==", ciphertext: "bm90LXJlYWwtZW5jcnlwdGVkLWRhdGE=" };
  await withApp({
    initialCredentials: [{
      id: credentialId, workspace_id: workspaceId, name: "Stored token", service: "sample",
      encrypted_payload: encryptedPayload, created_at: fixedTime, updated_at: fixedTime
    }]
  }, async ({ app, token }) => {
    const response = await request(app, token, "GET");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().credentials, [{
      id: credentialId, name: "Stored token", service: "sample",
      createdAt: fixedTime.toISOString(), updatedAt: fixedTime.toISOString()
    }]);
    assert.equal(JSON.stringify(response.json()).includes("encrypted_payload"), false);
    assert.equal(JSON.stringify(response.json()).includes("ciphertext"), false);
  });
});

test("rotating a credential replaces ciphertext, keeps the secret out of the response and audits the action", async () => {
  await withApp({
    initialCredentials: [{
      id: credentialId, workspace_id: workspaceId, name: "API", service: "example",
      encrypted_payload: { version: 1, iv: "", tag: "", ciphertext: "placeholder" },
      created_at: fixedTime, updated_at: fixedTime
    }]
  }, async ({ app, pool, token }) => {
    const response = await request(app, token, "PUT", "/" + credentialId, {
      name: "API v2", service: "example-v2", secret: { token: "replacement-secret" }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().credential.name, "API v2");
    assert.equal("secret" in response.json().credential, false);
    assert.equal("encrypted_payload" in response.json().credential, false);
    assert.deepEqual(decryptSecret(pool.credentials.get(credentialId).encrypted_payload), { token: "replacement-secret" });
    assert.equal(JSON.stringify(pool.credentials.get(credentialId).encrypted_payload).includes("replacement-secret"), false);
    assert.ok(pool.audits.some(item => item.params.includes("credential.rotate")));
  });
});

test("viewer members cannot rotate credentials", async () => {
  await withApp({
    role: "viewer",
    initialCredentials: [{
      id: credentialId, workspace_id: workspaceId, name: "API", service: "example",
      encrypted_payload: { version: 1, iv: "", tag: "", ciphertext: "unchanged" },
      created_at: fixedTime, updated_at: fixedTime
    }]
  }, async ({ app, pool, token }) => {
    const response = await request(app, token, "PUT", "/" + credentialId, {
      name: "API", service: "example", secret: { token: "replacement-secret" }
    });
    assert.equal(response.statusCode, 403);
    assert.equal(pool.credentials.get(credentialId).encrypted_payload.ciphertext, "unchanged");
    assert.equal(pool.audits.length, 0);
  });
});

test("credential rotation returns 404 for a credential outside the current workspace", async () => {
  await withApp({ initialCredentials: [] }, async ({ app, pool, token }) => {
    const response = await request(app, token, "PUT", "/" + credentialId, {
      name: "API", service: "example", secret: { token: "replacement-secret" }
    });
    assert.equal(response.statusCode, 404);
    assert.equal(pool.audits.length, 0);
  });
});

test("credential payloads must be JSON objects and duplicate names return a conflict", async () => {
  await withApp({}, async ({ app, pool, token }) => {
    const invalid = await request(app, token, "POST", "", { name: "Bad", service: "example", secret: ["not", "an", "object"] });
    assert.equal(invalid.statusCode, 422);
    assert.equal(pool.credentials.size, 0);
    await request(app, token, "POST", "", { name: "Same", service: "example", secret: { token: "one" } });
    const duplicate = await request(app, token, "POST", "", { name: "Same", service: "example", secret: { token: "two" } });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(pool.credentials.size, 1);
  });
});

test("credential routes require authentication", async () => {
  await withApp({}, async ({ app }) => {
    assert.equal((await request(app, null, "GET")).statusCode, 401);
    assert.equal((await request(app, null, "POST", "", { name: "API", service: "example", secret: { token: "x" } })).statusCode, 401);
  });
});
