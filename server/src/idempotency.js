import { createHash } from "node:crypto";

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) throw new Error("Idempotency-Key must be provided exactly once.");
  const key = String(value);
  if (key.length < 1 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key)) {
    throw new Error("Idempotency-Key must contain 1–128 printable ASCII characters without spaces.");
  }
  return key;
}

export function hashIdempotencyKey(key) {
  const normalized = normalizeIdempotencyKey(key);
  if (normalized === null) throw new Error("Idempotency-Key is required for hashing.");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function canonicalize(value, seen = new Set()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) throw new Error("Execution input must be acyclic JSON.");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map(item => canonicalize(item, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("Execution input must contain only JSON values.");
    result = Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key], seen)]));
  }
  seen.delete(value);
  return result;
}

export function hashExecutionRequest(input) {
  let canonical;
  try {
    canonical = JSON.stringify(canonicalize(input === undefined ? {} : input));
  } catch (error) {
    throw new Error("Execution input cannot be canonicalized for idempotency: " + error.message);
  }
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
