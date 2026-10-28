import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeWebhookBody, createWebhookSignature, verifyWebhookSignature } from "../src/webhook-signature.js";

const secret = "signature-secret-for-e11e-test-32-bytes-minimum";
const now = Date.parse("2026-10-28T12:00:00.000Z");
const timestamp = String(Math.floor(now / 1000));
const payload = { event: "ticket.created", user: { name: "Ada", id: 42 }, labels: ["urgent", "new"] };

test("canonical JSON sorts object keys recursively and preserves array order", () => {
  assert.equal(canonicalizeWebhookBody({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  assert.equal(canonicalizeWebhookBody([2, 1]), "[2,1]");
});

test("signature is stable when JSON object keys are ordered differently", () => {
  const signatureA = createWebhookSignature(secret, timestamp, { z: 1, a: { y: 2, x: 3 } });
  const signatureB = createWebhookSignature(secret, timestamp, { a: { x: 3, y: 2 }, z: 1 });
  assert.equal(signatureA, signatureB);
  assert.match(signatureA, /^sha256=[a-f0-9]{64}$/);
});

test("valid recent signature verifies", () => {
  const signature = createWebhookSignature(secret, timestamp, payload);
  assert.equal(verifyWebhookSignature({ secret, timestamp, signature, body: payload, now }), true);
});

test("signature verification rejects body tampering and wrong secrets", () => {
  const signature = createWebhookSignature(secret, timestamp, payload);
  assert.equal(verifyWebhookSignature({ secret, timestamp, signature, body: { ...payload, event: "ticket.deleted" }, now }), false);
  assert.equal(verifyWebhookSignature({ secret: secret + "-wrong", timestamp, signature, body: payload, now }), false);
});

test("signature verification rejects stale timestamps and invalid timestamp formats", () => {
  const signature = createWebhookSignature(secret, timestamp, payload);
  assert.equal(verifyWebhookSignature({ secret, timestamp, signature, body: payload, now: now + 301_000 }), false);
  assert.equal(verifyWebhookSignature({ secret, timestamp: "yesterday", signature, body: payload, now }), false);
  assert.equal(verifyWebhookSignature({ secret, timestamp: String(Number(timestamp) + 1000), signature, body: payload, now }), false);
});

test("signature verification rejects malformed signatures and weak secrets", () => {
  assert.equal(verifyWebhookSignature({ secret, timestamp, signature: "abcdef", body: payload, now }), false);
  assert.equal(verifyWebhookSignature({ secret: "weak", timestamp, signature: createWebhookSignature(secret, timestamp, payload), body: payload, now }), false);
  assert.throws(() => createWebhookSignature("short", timestamp, payload), /at least 32/);
  assert.throws(() => createWebhookSignature(secret, "1700000000.5", payload), /10-digit/);
});
