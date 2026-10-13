/**
 * Fetch helper for the data builder. Tries Node's fetch first; if a site refuses it (some bot protection
 * blocks Node's TLS fingerprint), it retries with curl, which most sites accept. Every failure is logged
 * with its HTTP status so the site's Sources panel can say exactly what went wrong.
 */
import { execFile } from "node:child_process";

export const fetchLog: { url: string; status: number | string; via: "fetch" | "curl" }[] = [];
const lastStatus = new Map<string, string>();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function buildUrl(url: string, params?: Record<string, string | number | undefined>) {
  if (!params) return url;
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
  return `${url}?${qs}`;
}

/** Human-readable reason the last request to this URL prefix failed, e.g. "blocked (403)". */
export function failureReason(urlPrefix: string): string {
  for (const [u, s] of [...lastStatus.entries()].reverse()) if (u.startsWith(urlPrefix)) return s;
  return "no response";
}

function describe(status: number | string): string {
  if (status === 401) return "key rejected or out of credits (401)";
  if (status === 403) return "blocked (403)";
  if (status === 404) return "not found (404)";
  if (status === 429) return "rate limited (429)";
  if (typeof status === "number") return `HTTP ${status}`;
  return status === "AbortError" ? "timed out" : `network error (${status})`;
}

async function viaFetch(full: string): Promise<{ ok: true; data: unknown } | { ok: false; status: number | string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(full, { signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9" } });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, status: (e as Error).name || "error" };
  }
}

function viaCurl(full: string): Promise<{ ok: true; data: unknown } | { ok: false; status: number | string }> {
  return new Promise((resolve) => {
    execFile("curl", ["-sS", "-L", "--compressed", "--max-time", "25", "-A", UA, "-H", "Accept: application/json, text/plain, */*",
      "-H", "Accept-Language: en-US,en;q=0.9", "-w", "\n%{http_code}", full], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return resolve({ ok: false, status: "curl-failed" });
      const cut = stdout.lastIndexOf("\n");
      const code = Number(stdout.slice(cut + 1));
      const body = stdout.slice(0, cut);
      if (code < 200 || code >= 300) return resolve({ ok: false, status: code || "curl-failed" });
      try { resolve({ ok: true, data: JSON.parse(body) }); } catch { resolve({ ok: false, status: "bad JSON" }); }
    });
  });
}

let curlWorks: boolean | null = null;   // once fetch is refused and curl succeeds, go straight to curl

export async function getJson<T = unknown>(url: string, params?: Record<string, string | number | undefined>): Promise<T | null> {
  const full = buildUrl(url, params);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (curlWorks !== true) {
      const r = await viaFetch(full);
      if (r.ok) return r.data as T;
      fetchLog.push({ url: full.slice(0, 160), status: r.status, via: "fetch" });
      lastStatus.set(full, describe(r.status));
      if (r.status === 404 || r.status === 401) return null;
    }
    const c = await viaCurl(full);
    if (c.ok) {
      if (curlWorks === null) curlWorks = true;
      lastStatus.delete(full);
      return c.data as T;
    }
    fetchLog.push({ url: full.slice(0, 160), status: c.status, via: "curl" });
    lastStatus.set(full, describe(c.status));
    if (c.status === 400 || c.status === 401 || c.status === 403 || c.status === 404) return null;   // a clear "no": retrying won't help
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/** Run async jobs with a concurrency cap so we stay polite to free APIs. */
export async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  });
  await Promise.all(workers);
  return out;
}
