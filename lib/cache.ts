/**
 * Cache layer: Upstash Redis / Vercel KV over REST when configured, otherwise an in-memory map.
 * Keeps odds pulls inside API rate limits while clients poll every 30-60 seconds.
 */
import { Redis } from "@upstash/redis";

type Entry = { value: unknown; expires: number };
const memory = new Map<string, Entry>();

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (redis) return (await redis.get<T>(key)) ?? null;
  const hit = memory.get(key);
  if (!hit || hit.expires < Date.now()) return null;
  return hit.value as T;
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (redis) {
    await redis.set(key, value, { ex: ttlSeconds });
    return;
  }
  memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

/** Read-through cache: return the cached value or compute, store and return it. */
export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit != null) return hit;
  const value = await compute();
  await cacheSet(key, value, ttlSeconds);
  return value;
}
