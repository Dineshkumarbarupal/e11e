import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";
const SIGNATURE_HEX = /^[a-f0-9]{64}$/i;
const TIMESTAMP_SECONDS = /^\d{10}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Serialize parsed JSON deterministically so signatures do not depend on object
 * property insertion order or whitespace in the original HTTP body.
 */
export function canonicalizeWebhookBody(value) {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error("Webhook body must be valid JSON.");
    return result;
  }
  if (Array.isArray(value)) {
    return "[" + value.map(item => canonicalizeWebhookBody(item)).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map(key => JSON.stringify(key) + ":" + canonicalizeWebhookBody(value[key])).join(",") + "}";
}

function validSignatureSecret(secret) {
  return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32;
}

export function createWebhookSignature(secret, timestamp, body, eventId) {
  if (!validSignatureSecret(secret)) throw new Error("Webhook signature secret must contain at least 32 UTF-8 bytes.");
  if (typeof timestamp !== "string" || !TIMESTAMP_SECONDS.test(timestamp)) {
    throw new Error("Webhook timestamp must be Unix epoch seconds as a 10-digit string.");
  }
  if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) throw new Error("Webhook event ID must be supplied and use 1-128 supported characters.");
  const canonicalBody = canonicalizeWebhookBody(body === undefined ? {} : body);
  const digest = createHmac("sha256", secret).update(timestamp + "." + eventId + "." + canonicalBody, "utf8").digest("hex");
  return SIGNATURE_PREFIX + digest;
}

/**
 * Verify an HMAC-SHA256 signature over timestamp + "." + canonical JSON body.
 * Default clock tolerance is five minutes. Invalid input safely returns false.
 */
export function verifyWebhookSignature({
  secret,
  timestamp,
  signature,
  body,
  now = Date.now(),
  toleranceSeconds = 300,
  eventId
} = {}) {
  try {
    if (!validSignatureSecret(secret)) return false;
    if (typeof timestamp !== "string" || !TIMESTAMP_SECONDS.test(timestamp)) return false;
    if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) return false;
    if (typeof signature !== "string") return false;
    const match = signature.match(/^sha256=([a-f0-9]{64})$/i);
    if (!match) return false;
    if (!Number.isFinite(now) || !Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) return false;
    const skew = Math.abs(Math.floor(now / 1000) - Number(timestamp));
    if (skew > toleranceSeconds) return false;
    const expectedHex = createWebhookSignature(secret, timestamp, body, eventId).slice(SIGNATURE_PREFIX.length);
    const expected = Buffer.from(expectedHex, "hex");
    const actual = Buffer.from(match[1], "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
