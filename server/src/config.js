import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  CREDENTIAL_ENCRYPTION_KEY_HEX: z.string().regex(/^[a-fA-F0-9]{64}$/, "Credential encryption key must be exactly 64 hex characters."),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  HTTP_ALLOWED_HOSTS: z.string().default(""),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(10000).default(100),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(60)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid server environment: ${details}`);
}
export const config = {
  ...parsed.data,
  CORS_ORIGINS: parsed.data.CORS_ORIGINS.split(",").map(origin => origin.trim()).filter(Boolean),
  HTTP_ALLOWED_HOSTS: parsed.data.HTTP_ALLOWED_HOSTS.split(",").map(host => host.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean)
};
