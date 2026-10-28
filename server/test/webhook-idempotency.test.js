import test from "node:test";
import assert from "node:assert/strict";
import { getWebhookDedupeKey, hashWebhookEventId } from "../src/webhook-idempotency.js";

test("omitted event ID disables webhook deduplication", () => {
  assert.equal(hashWebhookEventId(undefined), null);
  assert.equal(hashWebhookEventId(null), null);
  assert.equal(getWebhookDedupeKey({}), null);
});

test("event IDs are hashed, fixed length, and not stored as raw text", () => {
  const raw = "evt_created:42";
  const hash = hashWebhookEventId(raw);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, raw);
  assert.equal(hashWebhookEventId(raw), hash);
});

test("accepts the E11E event header and the common Idempotency-Key header", () => {
  const hash = hashWebhookEventId("evt_ABC-123.4");
  assert.equal(getWebhookDedupeKey({ "x-e11e-event-id": "evt_ABC-123.4" }), hash);
  assert.equal(getWebhookDedupeKey({ "idempotency-key": "evt_ABC-123.4" }), hash);
});

test("rejects malformed or oversized event identifiers", () => {
  for (const value of ["", "contains spaces", "bad/slash", "line\nbreak", "x".repeat(129), ["repeated-header"]]) {
    assert.throws(() => hashWebhookEventId(value), /Webhook event ID must be/);
  }
});

test("rejects conflicting values when both supported event-ID headers are present", () => {
  assert.throws(
    () => getWebhookDedupeKey({ "x-e11e-event-id": "event-a", "idempotency-key": "event-b" }),
    /Provide only one/
  );
});

test("hashes equivalent supported headers to the same dedupe key", () => {
  const a = getWebhookDedupeKey({ "x-e11e-event-id": "event-001" });
  const b = getWebhookDedupeKey({ "idempotency-key": "event-001" });
  assert.equal(a, b);
});
