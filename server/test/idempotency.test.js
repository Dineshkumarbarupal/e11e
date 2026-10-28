import test from "node:test";
import assert from "node:assert/strict";
import { hashExecutionRequest, hashIdempotencyKey, normalizeIdempotencyKey } from "../src/idempotency.js";

test("idempotency keys are optional but reject duplicates, spaces and control characters", () => {
  assert.equal(normalizeIdempotencyKey(undefined), null);
  assert.equal(normalizeIdempotencyKey(null), null);
  assert.equal(normalizeIdempotencyKey("request-123"), "request-123");
  assert.throws(() => normalizeIdempotencyKey(["first", "second"]), /exactly once/);
  assert.throws(() => normalizeIdempotencyKey("key with spaces"), /printable ASCII/);
  assert.throws(() => normalizeIdempotencyKey("bad\nkey"), /printable ASCII/);
  assert.throws(() => normalizeIdempotencyKey("x".repeat(129)), /1–128/);
});

test("idempotency key hashing is stable and never returns the original key", () => {
  const rawKey = "client-request-123";
  const hashed = hashIdempotencyKey(rawKey);
  assert.match(hashed, /^[a-f0-9]{64}$/);
  assert.equal(hashIdempotencyKey(rawKey), hashed);
  assert.notEqual(hashed, rawKey);
});

test("execution request hash ignores object-key order but preserves array order", () => {
  const first = { approved: true, user: { email: "person@example.test", name: "Ada" }, items: [1, 2] };
  const same = { items: [1, 2], user: { name: "Ada", email: "person@example.test" }, approved: true };
  const different = { ...same, items: [2, 1] };
  assert.equal(hashExecutionRequest(first), hashExecutionRequest(same));
  assert.notEqual(hashExecutionRequest(first), hashExecutionRequest(different));
  assert.deepEqual(first.items, [1, 2]);
});

test("execution request hashing defaults missing input to an empty object", () => {
  assert.equal(hashExecutionRequest(undefined), hashExecutionRequest({}));
});

test("execution request hashing rejects cycles and non-JSON object instances", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => hashExecutionRequest(cyclic), /acyclic JSON/);
  assert.throws(() => hashExecutionRequest({ when: new Date() }), /only JSON values/);
});
