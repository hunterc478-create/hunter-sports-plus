/**
 * Scheduled data build (GitHub Actions). Writes:
 *   data/live.json            day-by-day dashboard bundle, read by the static build
 *   public/data/history.json  the transparency log, published with the site so the next run can continue it
 * If nothing could be priced, it keeps the last published bundle instead of blanking the site.
 */
import fs from "node:fs";
import path from "node:path";
import type { GameResults, TrackedPick } from "@/types/sports";
import { buildLive, type PropResults } from "@/lib/live/build";
import type { LiveBundle } from "@/lib/live/assemble";
import { notifyNewPicks } from "@/lib/live/notify";
import { applyOpeners, type Openers } from "@/lib/live/openers";

const SITE = (process.env.SITE_URL ?? "").replace(/\/$/, "");

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

async function main() {
  const prevHistory = (SITE && (await fetchJson<TrackedPick[]>(`${SITE}/data/history.json`))) || [];
  const prevBundle = SITE ? await fetchJson<LiveBundle>(`${SITE}/data/live.json`) : null;

  const { bundle, history, results, propResults } = await buildLive(prevHistory, prevBundle?.byDay?.all?.props ?? [], prevBundle?.propsLoadedAt, prevBundle?.byDay?.all?.matchups ?? []);
  let out = bundle;
  if (!bundle.byDay.all.matchups.length && prevBundle?.byDay?.all?.matchups?.length) {
    console.log("No games priced this run; keeping the last good board.");
    out = { ...prevBundle, status: { ...bundle.status, notes: [...bundle.status.notes, "This update couldn't price any games, so you're seeing the previous board."] } };
  }

  const openers = applyOpeners(out, (SITE && (await fetchJson<Openers>(`${SITE}/data/openers.json`))) || {}, new Date().toISOString());

  fs.mkdirSync("data", { recursive: true });
  fs.mkdirSync(path.join("public", "data"), { recursive: true });
  fs.writeFileSync(path.join("data", "live.json"), JSON.stringify(out));
  fs.writeFileSync(path.join("public", "data", "live.json"), JSON.stringify(out));
  fs.writeFileSync(path.join("public", "data", "history.json"), JSON.stringify(history));
  fs.writeFileSync(path.join("public", "data", "openers.json"), JSON.stringify(openers));
  // keep a rolling two weeks of finals: this run's (last 7 days) plus older ones still within the window
  const prevResults = (SITE && (await fetchJson<GameResults>(`${SITE}/data/results.json`))) || {};
  const cutoff = Date.now() - 14 * 86_400_000;
  const keep = Object.fromEntries(Object.entries({ ...prevResults, ...results }).filter(([, r]) => new Date(r.start).getTime() > cutoff));
  fs.writeFileSync(path.join("public", "data", "results.json"), JSON.stringify(keep));
  const prevProps = (SITE && (await fetchJson<PropResults>(`${SITE}/data/prop-results.json`))) || {};
  const keepProps = Object.fromEntries(Object.entries({ ...prevProps, ...propResults }).filter(([, r]) => new Date(r.start).getTime() > Date.now() - 21 * 86_400_000));
  fs.writeFileSync(path.join("public", "data", "prop-results.json"), JSON.stringify(keepProps));

  const alerts = await notifyNewPicks(prevHistory, history, SITE);
  if (alerts) console.log(`Phone alerts sent: ${alerts}`);

  const all = out.byDay.all;
  console.log(`Days: ${out.days.join(", ") || "none"}`);
  console.log(`Games priced: ${all.matchups.length} · +EV picks: ${all.topPicks.length} · props: ${all.props.length} · parlays: ${all.parlays.length}`);
  for (const s of out.status.sources) console.log(`  ${s.ok ? "OK  " : "FAIL"} ${s.name}: ${s.detail}`);
  for (const n of out.status.notes) console.log(`  note: ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
