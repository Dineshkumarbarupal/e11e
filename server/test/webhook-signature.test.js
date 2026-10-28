import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeWebhookBody, createWebhookSignature, verifyWebhookSignature } from "../src/webhook-signature.js";

const secret = "signature-secret-for-e11e-test-32-bytes-minimum";
const now = Date.parse("2026-10-28T12:00:00.000Z");
const timestamp = String(Math.floor(now / 1000));
const eventId = "evt_ticket_created_42";
const payload = { event: "ticket.created", user: { name: "Ada", id: 42 }, labels: ["urgent", "new"] };

test("canonical JSON sorts object keys recursively and preserves array order", () => {
  assert.equal(canonicalizeWebhookBody({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  assert.equal(canonicalizeWebhookBody([2, 1]), "[2,1]");
});

test("signature is stable when JSON object keys are ordered differently", () => {
  const signatureA = createWebhookSignature(secret, timestamp, { z: 1, a: { y: 2, x: 3 } }, eventId);
  const signatureB = createWebhookSignature(secret, timestamp, { a: { x: 3, y: 2 }, z: 1 }, eventId);
  assert.equal(signatureA, signatureB);
  assert.match(signatureA, /^sha256=[a-f0-9]{64}$/);
});

test("valid recent signature verifies only with the original event ID", () => {
  const signature = createWebhookSignature(secret, timestamp, payload, eventId);
  assert.equal(verifyWebhookSignature({ secret, timestamp, signature, body: payload, now, eventId }), true);
  assert.equal(verifyWebhookSignature({ secret, timestamp, signature, body: payload, now, eventId: "evt_different" }), false);
});

test("signature verification rejects body tampering and wrong secrets", () => {
  const signature = createWebhookSignature(secret, timestamp, payload, eventId);
  assert.equal(verifyWebhookSignature({ secret, timestamp, signature, body: { ...payload, event: "ticket.deleted" }, now, eventId }), false);
  assert.equal(verifyWebhookSignature({ secret: secret + "-wrong", timestamp, signature, body: payload, now, eventId }), false);
});

test("signature verification rejects stale timestamps and invalid timestamp formats", () => {
  const signature = createWebhookSignature(secret, timestamp, payload, eventId);
  assert.equal(verifyWebhookSignature({ secret, timestamp, signature, body: payload, now: now + 301_000, eventId }), false);
  assert.equal(verifyWebhookSignature({ secret, timestamp: "yesterday", signature, body: payload, now, eventId }), false);
  assert.equal(verifyWebhookSignature({ secret, timestamp: String(Number(timestamp) + 1000), signature, body: payload, now, eventId }), false);
});

test("signature verification rejects malformed signatures, missing event IDs and weak secrets", () => {
  assert.equal(verifyWebhookSignature({ secret, timestamp, signature: "abcdef", body: payload, now, eventId }), false);
  const signature = createWebhookSignature(secret, timestamp, payload, eventId);
  assert.equal(verifyWebhookSignature({ secret: "weak", timestamp, signature, body: payload, now, eventId }), false);
  assert.equal(verifyWebhookSignature({ secret, timestamp, signature, body: payload, now }), false);
  assert.throws(() => createWebhookSignature("short", timestamp, payload, eventId), /at least 32/);
  assert.throws(() => createWebhookSignature(secret, "1700000000.5", payload, eventId), /10-digit/);
  assert.throws(() => createWebhookSignature(secret, timestamp, payload), /event ID must be supplied/);
});
