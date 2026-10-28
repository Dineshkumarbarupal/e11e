import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "unit-test-jwt-secret-that-is-long-enough-for-validation";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.CREDENTIAL_ENCRYPTION_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { encryptSecret, decryptSecret } = await import("../src/crypto.js");

test("credential payload round-trips through AES-GCM", () => {
  const original = { token: "placeholder-secret", nested: { key: "value" }, enabled: true };
  const encrypted = encryptSecret(original);
  assert.equal(JSON.stringify(encrypted).includes("placeholder-secret"), false);
  assert.deepEqual(decryptSecret(encrypted), original);
});

test("credential payload cannot be changed without failing authentication", () => {
  const encrypted = encryptSecret({ apiKey: "test-value" });
  encrypted.ciphertext = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptSecret(encrypted));
});
