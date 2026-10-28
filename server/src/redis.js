import IORedis from "ioredis";
import { config } from "./config.js";

export const redis = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true
});
export async function connectRedis() {
  if (redis.status === "wait") await redis.connect();
  await redis.ping();
}
export async function closeRedis() {
  if (redis.status !== "end") await redis.quit();
}
