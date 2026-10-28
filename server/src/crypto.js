import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "./config.js";

const key = Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY_HEX, "hex");
if (key.length !== 32) throw new Error("Credential encryption key must decode to 32 bytes.");

export function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { version: 1, iv: iv.toString("base64"), tag: tag.toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function decryptSecret(payload) {
  if (!payload || payload.version !== 1) throw new Error("Unsupported encrypted credential format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
