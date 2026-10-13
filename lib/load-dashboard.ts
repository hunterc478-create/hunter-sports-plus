/**
 * Build-time loader for the static site. Uses data/live.json written by scripts/build-data.ts,
 * and falls back to mock data (clearly labeled) when live data isn't there.
 */
import fs from "node:fs";
import path from "node:path";
import type { LiveBundle } from "@/lib/live/assemble";
import { buildMockBundle } from "@/lib/mock-data";

let cache: LiveBundle | null = null;

export function loadBundle(): LiveBundle {
  if (cache) return cache;
  const file = path.join(process.cwd(), "data", "live.json");
  try {
    if (fs.existsSync(file)) {
      const b = JSON.parse(fs.readFileSync(file, "utf8")) as LiveBundle;
      if (b?.byDay?.all) return (cache = b);
    }
  } catch {
    // fall through to mock
  }
  return (cache = buildMockBundle());
}
