/**
 * Phone alerts through ntfy (free app, no account): every pick newly logged this run is pushed to a private topic.
 *   NTFY_TOPIC  repo secret; the topic name is the only key, so keep it long and random. Unset = no alerts.
 *   NOTIFY      repo variable: "locks" (default) or "all" (locks plus game picks)
 * Picks are logged about two hours before start, so that's when the alert lands, at the posted price.
 */
import type { TrackedPick } from "@/types/sports";
import { DAY_TZ } from "./day";

const MAX_PER_RUN = 10;   // a backlog (e.g. after a stuck queue) shouldn't buzz the phone 40 times

export async function notifyNewPicks(prev: TrackedPick[], next: TrackedPick[], siteUrl: string): Promise<number> {
  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) return 0;
  const all = (process.env.NOTIFY ?? "").trim().toLowerCase() === "all";
  const had = new Set(prev.map((p) => p.id));
  const fresh = next.filter((p) => !had.has(p.id) && p.result === "pending" && (p.kind === "lock" || (all && p.kind === "single")));
  let sent = 0;
  for (const p of fresh.slice(0, MAX_PER_RUN)) {
    const start = p.grade?.start
      ? new Date(p.grade.start).toLocaleString("en-US", { timeZone: DAY_TZ, weekday: "short", hour: "numeric", minute: "2-digit" })
      : "soon";
    const odds = p.americanOdds > 0 ? `+${p.americanOdds}` : `${p.americanOdds}`;
    const body = {
      topic,
      title: `${p.kind === "lock" ? "LOCK" : "PICK"}: ${p.label.replace(/ \(.*\)$/, "")} (${odds})`,
      message: `${p.label.match(/\((.*)\)$/)?.[1] ?? p.league} · starts ${start}\n${Math.round(p.modelProb * 100)}% hit chance · ${p.league}`,
      tags: [p.kind === "lock" ? "lock" : "chart_with_upwards_trend"],
      click: siteUrl ? `${siteUrl}/${p.kind === "lock" ? "locks" : "ev-picks"}/` : undefined,
    };
    try {
      const r = await fetch("https://ntfy.sh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) sent++;
    } catch {
      // an alert failing must never fail the data build
    }
  }
  return sent;
}
