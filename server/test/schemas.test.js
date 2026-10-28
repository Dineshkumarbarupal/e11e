import test from "node:test";
import assert from "node:assert/strict";
import { workflowSchema, registerSchema, credentialSchema } from "../src/schemas.js";

const validFlow = () => ({
  id: "test-flow",
  name: "A valid workflow",
  active: false,
  nodes: [
    { id: "a", type: "manual", name: "Start", x: 0, y: 0, config: {} },
    { id: "b", type: "set", name: "Set fields", x: 200, y: 0, config: { fields: { hello: "world" } } }
  ],
  edges: [{ id: "ab", source: "a", target: "b" }]
});

test("workflow schema accepts a simple acyclic flow", () => {
  assert.equal(workflowSchema.safeParse(validFlow()).success, true);
});

test("workflow schema rejects an edge to a missing node", () => {
  const flow = validFlow();
  flow.edges.push({ id: "broken", source: "a", target: "missing" });
  assert.equal(workflowSchema.safeParse(flow).success, false);
});

test("workflow schema rejects cycles", () => {
  const flow = validFlow();
  flow.edges.push({ id: "cycle", source: "b", target: "a" });
  const result = workflowSchema.safeParse(flow);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.message.includes("Cycles are not supported")));
});

test("registration requires a strong password", () => {
  assert.equal(registerSchema.safeParse({ email: "a@example.com", name: "A", password: "short" }).success, false);
});

test("credential secret payload must be an object", () => {
  assert.equal(credentialSchema.safeParse({ name: "API", service: "example", secret: "plaintext" }).success, false);
  assert.equal(credentialSchema.safeParse({ name: "API", service: "example", secret: { key: "placeholder" } }).success, true);
});


test("workflow schema accepts a valid schedule node", () => {
  const flow = validFlow();
  flow.nodes.push({ id: "schedule", type: "schedule", name: "Schedule", x: 0, y: 180, config: { cron: "0 9 * * 1-5" } });
  assert.equal(workflowSchema.safeParse(flow).success, true);
});

test("workflow schema rejects an invalid schedule cron expression", () => {
  const flow = validFlow();
  flow.nodes.push({ id: "schedule", type: "schedule", name: "Schedule", x: 0, y: 180, config: { cron: "99 * * * *" } });
  const result = workflowSchema.safeParse(flow);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.path.includes("cron")));
});


test("workflow schema rejects connections into trigger nodes", () => {
  const flow = validFlow();
  flow.edges.push({ id: "into-trigger", source: "b", target: "a" });
  const result = workflowSchema.safeParse(flow);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.message.includes("Trigger nodes cannot have incoming connections")));
});


test("workflow schema accepts an HTTP credential reference UUID", () => {
  const flow = validFlow();
  flow.nodes.push({
    id: "http", type: "http", name: "Secure request", x: 0, y: 180,
    config: { url: "https://api.example.test", credentialId: "123e4567-e89b-42d3-a456-426614174000" }
  });
  assert.equal(workflowSchema.safeParse(flow).success, true);
});

test("workflow schema rejects a malformed HTTP credential reference", () => {
  const flow = validFlow();
  flow.nodes.push({ id: "http", type: "http", name: "Secure request", x: 0, y: 180, config: { credentialId: "not-a-uuid" } });
  const result = workflowSchema.safeParse(flow);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.path.includes("credentialId")));
});


test("workflow schema accepts an enabled webhook signature requirement", () => {
  const flow = validFlow();
  flow.nodes[0].type = "webhook";
  flow.nodes[0].config = { requireSignature: true };
  assert.equal(workflowSchema.safeParse(flow).success, true);
});

test("workflow schema rejects a non-boolean webhook signature requirement", () => {
  const flow = validFlow();
  flow.nodes[0].type = "webhook";
  flow.nodes[0].config = { requireSignature: "true" };
  const result = workflowSchema.safeParse(flow);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.path.includes("requireSignature")));
});
