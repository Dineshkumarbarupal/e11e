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
