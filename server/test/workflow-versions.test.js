import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-jwt-secret-that-is-long-enough-for-validation";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.CREDENTIAL_ENCRYPTION_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CORS_ORIGINS = "http://localhost:5173";

const { buildApp } = await import("../src/app.js");

const workspaceId = "223e4567-e89b-42d3-a456-426614174000";
const userId = "323e4567-e89b-42d3-a456-426614174000";
const workflowId = "423e4567-e89b-42d3-a456-426614174000";

function flow(name) {
  return {
    id: workflowId,
    name,
    active: false,
    nodes: [{ id: "manual_1", type: "manual", name: "Manual", x: 100, y: 100, config: {} }],
    edges: []
  };
}

function makePool({ role = "owner", exists = true } = {}) {
  const now = new Date("2026-10-28T08:00:00.000Z");
  const workflow = exists ? {
    id: workflowId,
    workspace_id: workspaceId,
    name: "Version three",
    active: false,
    definition: flow("Version three"),
    version: 3,
    created_by: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now
  } : null;
  const versions = exists ? [
    { workspace_id: workspaceId, workflow_id: workflowId, version: 3, name: "Version three", active: false, definition: flow("Version three"), created_by: userId, created_at: now },
    { workspace_id: workspaceId, workflow_id: workflowId, version: 2, name: "Version two", active: true, definition: { ...flow("Version two"), active: true }, created_by: userId, created_at: new Date("2026-10-27T08:00:00Z") },
    { workspace_id: workspaceId, workflow_id: workflowId, version: 1, name: "Version one", active: false, definition: flow("Version one"), created_by: userId, created_at: new Date("2026-10-26T08:00:00Z") }
  ] : [];
  const audits = [];
  return {
    workflow,
    versions,
    audits,
    async query(sql, params = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (statement.startsWith("SELECT role FROM workspace_members")) return { rows: [{ role }] };

      if (statement.startsWith("SELECT version,name,active,created_by,created_at FROM workflow_versions")) {
        return { rows: versions
          .filter(row => row.workspace_id === params[0] && row.workflow_id === params[1])
          .sort((a, b) => b.version - a.version)
          .slice(0, 50) };
      }

      if (statement.startsWith("SELECT id FROM workflows WHERE workspace_id=$1 AND id=$2")) {
        return { rows: workflow && workflow.workspace_id === params[0] && workflow.id === params[1] ? [{ id: workflow.id }] : [] };
      }

      if (statement.startsWith("SELECT version,name,active,definition,created_by,created_at FROM workflow_versions")) {
        const row = versions.find(item => item.workspace_id === params[0] && item.workflow_id === params[1] && item.version === params[2]);
        return { rows: row ? [row] : [] };
      }

      if (statement.startsWith("SELECT definition FROM workflow_versions")) {
        const row = versions.find(item => item.workspace_id === params[0] && item.workflow_id === params[1] && item.version === params[2]);
        return { rows: row ? [{ definition: row.definition }] : [] };
      }

      if (statement.startsWith("UPDATE workflows SET name=$3,active=$4,definition=$5::jsonb,version=version+1")) {
        if (!workflow || workflow.workspace_id !== params[0] || workflow.id !== params[1]) return { rows: [] };
        workflow.name = params[2];
        workflow.active = params[3];
        workflow.definition = JSON.parse(params[4]);
        workflow.version += 1;
        workflow.updated_by = params[5];
        workflow.updated_at = new Date("2026-10-28T09:00:00.000Z");
        versions.push({
          workspace_id: workspaceId, workflow_id: workflowId, version: workflow.version,
          name: workflow.name, active: workflow.active, definition: workflow.definition,
          created_by: workflow.updated_by, created_at: workflow.updated_at
        });
        return { rows: [{ ...workflow }] };
      }

      if (statement.startsWith("INSERT INTO audit_logs")) {
        audits.push({ statement, params });
        return { rows: [] };
      }

      throw new Error("Unexpected SQL in workflow version test: " + statement);
    }
  };
}

async function withApp(options, fn) {
  const pool = makePool(options);
  const app = await buildApp({ pool });
  const token = app.jwt.sign({ sub: userId, email: "versions@example.test" });
  try {
    await fn({ app, pool, token });
  } finally {
    await app.close();
  }
}

const baseUrl = "/api/workspaces/" + workspaceId + "/workflows/" + workflowId;
function request(app, token, method, suffix = "", payload) {
  return app.inject({
    method,
    url: baseUrl + suffix,
    headers: token ? { authorization: "Bearer " + token } : {},
    ...(payload === undefined ? {} : { payload })
  });
}

test("workflow version list returns newest-first metadata only", async () => {
  await withApp({}, async ({ app, token }) => {
    const response = await request(app, token, "GET", "/versions");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().versions.map(item => item.version), [3, 2, 1]);
    assert.equal(response.json().versions[0].name, "Version three");
    assert.equal("definition" in response.json().versions[0], false);
  });
});

test("workflow version detail returns the immutable saved definition", async () => {
  await withApp({}, async ({ app, token }) => {
    const response = await request(app, token, "GET", "/versions/2");
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().version.version, 2);
    assert.equal(response.json().version.definition.name, "Version two");
    assert.equal(response.json().version.definition.active, true);
  });
});

test("restoring an old workflow snapshot creates a new current version", async () => {
  await withApp({}, async ({ app, pool, token }) => {
    const response = await request(app, token, "POST", "/versions/2/restore");
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().restoredFromVersion, 2);
    assert.equal(response.json().workflow.version, 4);
    assert.equal(response.json().workflow.name, "Version two");
    assert.equal(pool.workflow.version, 4);
    assert.equal(pool.workflow.definition.name, "Version two");
    assert.ok(pool.versions.some(item => item.version === 4 && item.name === "Version two"));
    assert.equal(pool.audits.length, 1);
    assert.equal(pool.audits[0].params[3], "workflow.restore");
  });
});

test("workflow version endpoints reject invalid identifiers and version numbers", async () => {
  await withApp({}, async ({ app, token }) => {
    assert.equal((await request(app, token, "GET", "/versions/0")).statusCode, 400);
    const invalidId = await app.inject({
      method: "GET",
      url: "/api/workspaces/" + workspaceId + "/workflows/not-a-uuid/versions",
      headers: { authorization: "Bearer " + token }
    });
    assert.equal(invalidId.statusCode, 400);
  });
});

test("workflow version endpoints return 404 for a missing workflow or snapshot", async () => {
  await withApp({ exists: false }, async ({ app, token }) => {
    assert.equal((await request(app, token, "GET", "/versions")).statusCode, 404);
  });
  await withApp({}, async ({ app, token }) => {
    assert.equal((await request(app, token, "GET", "/versions/50")).statusCode, 404);
    assert.equal((await request(app, token, "POST", "/versions/50/restore")).statusCode, 404);
  });
});

test("restoring a workflow version requires a writable workspace role", async () => {
  await withApp({ role: "viewer" }, async ({ app, pool, token }) => {
    const response = await request(app, token, "POST", "/versions/2/restore");
    assert.equal(response.statusCode, 403);
    assert.equal(pool.workflow.version, 3);
    assert.equal(pool.audits.length, 0);
  });
});

test("workflow history endpoints require authentication", async () => {
  await withApp({}, async ({ app }) => {
    assert.equal((await request(app, null, "GET", "/versions")).statusCode, 401);
    assert.equal((await request(app, null, "GET", "/versions/1")).statusCode, 401);
  });
});
