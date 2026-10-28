import { createHash } from "node:crypto";

const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Normalize a provider event identifier into a fixed-size one-way key suitable
 * for a database uniqueness constraint. The raw provider value is never stored.
 */
export function hashWebhookEventId(eventId) {
  if (eventId == null) return null;
  if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) {
    throw new Error("Webhook event ID must be 1-128 characters using letters, digits, dot, underscore, colon or hyphen.");
  }
  return createHash("sha256").update(eventId, "utf8").digest("hex");
}

export function getWebhookDedupeKey(headers = {}) {
  const eventId = headers["x-e11e-event-id"];
  const idempotencyKey = headers["idempotency-key"];
  if (eventId !== undefined && idempotencyKey !== undefined && eventId !== idempotencyKey) {
    throw new Error("Provide only one webhook event ID, or use the same value in both headers.");
  }
  return hashWebhookEventId(eventId === undefined ? idempotencyKey : eventId);
}
