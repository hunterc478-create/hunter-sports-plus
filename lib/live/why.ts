/**
 * The "Why?" lists: every factor behind a game's projection and a player's projection, one plain line each, with its
 * effect so the site can mark it as helping or hurting the side you're looking at. Factors the model uses carry their
 * real effect; the rest (unit-vs-unit rankings, recent form, weather on props) are marked as context.
 */
import type { MatchupCardData, WhyPart } from "@/types/sports";
import { ordinal, toNflverseAbbr, type TeamUnits } from "./players/nfl";
import { LEAGUES } from "@/lib/leagues";

const r0 = (x: number) => Math.round(x);
const WEIGHT: Record<string, number> = { out: 1, doubtful: 0.75, questionable: 0.25, probable: 0.05, day_to_day: 0.25 };

export function gameWhy(c: MatchupCardData, units?: Map<string, TeamUnits> | null): WhyPart[] {
  const m = c.matchup, f = c.factors, P = c.prediction;
  const H = m.home.shortName, A = m.away.shortName;
  const out: WhyPart[] = [];
  const mg = P.projectedMargin;
  if (LEAGUES[m.league]?.sport === "tennis") {
    const fav = P.homeWinProb >= 0.5 ? H : A;
    out.push({ k: "Our projection", text: `${fav} ${Math.round(Math.max(P.homeWinProb, P.awayWinProb) * 100)}% to win`, m: mg, v: 1 });
    for (const t of P.triggers) out.push({ k: t.label, text: t.detail, m: t.marginImpact });
    return out;
  }
  out.push({ k: "Our projection", text: `${H} ${r0(P.projectedScore.home)}, ${A} ${r0(P.projectedScore.away)} (${mg >= 0 ? H : A} by ${Math.abs(mg).toFixed(1)}, total ${P.projectedTotal.toFixed(1)})`, m: mg, t: P.projectedTotal, v: 1 });

  const has = (cat: string) => P.triggers.some((t) => t.category === cat);
  for (const t of P.triggers) {
    if (t.label === "League calibration" || t.category === "injury") continue;
    out.push({ k: t.label, text: t.detail, m: t.marginImpact, t: t.totalImpact });
  }

  // injuries, one line per team, so you can see whose losses they are
  for (const side of ["home", "away"] as const) {
    const list = f[side].injuries.filter((i) => i.status !== "probable");
    if (!list.length) continue;
    const name = side === "home" ? H : A;
    const fmt = (st: string) => list.filter((i) => i.status === st).map((i) => `${i.playerName} (${i.position})`);
    const bits = [["Out", fmt("out")], ["Doubtful", fmt("doubtful")], ["Questionable", fmt("questionable").concat(fmt("day_to_day"))]]
      .filter(([, l]) => l.length).map(([lab, l]) => `${lab}: ${(l as string[]).join(", ")}`);
    const hit = list.reduce((s, i) => s + i.impact * (WEIGHT[i.status] ?? 0), 0);
    out.push({ k: `${name} injuries`, text: bits.join(" · "), m: side === "home" ? -hit : hit });
  }

  const hr = f.home.rest, ar = f.away.rest;
  if (!has("rest") && hr && ar) {
    const short = (d: number) => (d <= 5 ? " (short week)" : d >= 10 ? " (extra rest)" : "");
    out.push({ k: "Rest", text: `${H} ${hr.daysRest} days${short(hr.daysRest)}, ${A} ${ar.daysRest} days${short(ar.daysRest)}: no real edge` });
  }
  if (!has("travel") && ar?.travelMiles)
    out.push({ k: "Travel", text: `${A} travel about ${r0(ar.travelMiles).toLocaleString("en-US")} miles${ar.timezonesCrossed ? `, ${ar.timezonesCrossed} time zone${ar.timezonesCrossed > 1 ? "s" : ""}` : ", same time zone"}: no real effect` });
  if (!has("weather")) {
    const w = f.weather;
    out.push(w ? { k: "Weather", text: `${r0(w.temperatureF)}°F, ${r0(w.windMph)} mph wind, ${r0(w.precipitationChance * 100)}% chance of rain: no real effect` }
      : { k: "Weather", text: "Indoors (or no forecast yet): no weather effect" });
  }

  // unit vs unit: who moves the ball where, against whom (context: the model uses overall team ratings)
  const hu = units?.get(toNflverseAbbr(m.home.abbreviation)), au = units?.get(toNflverseAbbr(m.away.abbreviation));
  if (units && hu && au) {
    const all = [...units.values()];
    const avg = (k: keyof Omit<TeamUnits, "rank" | "games">) => all.reduce((s, u) => s + u[k], 0) / all.length;
    const lg = { passFor: avg("passFor"), rushFor: avg("rushFor"), passAllowed: avg("passAllowed"), rushAllowed: avg("rushAllowed") };
    for (const [off, def, on, dn, sign] of [[hu, au, H, A, 1], [au, hu, A, H, -1]] as const) {
      for (const kind of ["pass", "rush"] as const) {
        const F = kind === "pass" ? "passFor" : "rushFor", D = kind === "pass" ? "passAllowed" : "rushAllowed";
        const adv = (off[F] / lg[F] - 1) + (def[D] / lg[D] - 1);
        const tag = adv > 0.15 ? `: edge ${on}` : adv < -0.15 ? `: edge ${dn} defense` : ": even";
        out.push({ k: `${on} ${kind}ing vs ${dn} D`, text: `${on} ${kind} offense ${ordinal(off.rank[F])} (${r0(off[F])} yds/g) vs ${dn} ${kind} defense ${ordinal(def.rank[D])} (${r0(def[D])} allowed/g)${tag}`,
          m: sign * adv * 5, t: adv * 5, ctx: true });
      }
    }
  }
  return out;
}

/** Game context for one player's prop: weather and how the game should flow. Shown as context, not in the number. */
export function propContext(c: MatchupCardData, isHome: boolean, stat: string): WhyPart[] {
  const out: WhyPart[] = [];
  const air = stat === "passing_yards" || stat === "receiving_yards" || stat === "receptions" || stat === "passing_tds";
  const w = c.factors.weather;
  if (!w) out.push({ k: "Weather", text: "Indoors (or no forecast yet): no weather effect", ctx: true });
  else if (air && (w.windMph >= 15 || w.precipitationChance >= 0.5))
    out.push({ k: "Weather", text: `${r0(w.windMph)} mph wind, ${r0(w.precipitationChance * 100)}% rain: tougher to throw`, f: 0.95, ctx: true });
  else if (!air && (w.windMph >= 15 || w.precipitationChance >= 0.5))
    out.push({ k: "Weather", text: `${r0(w.windMph)} mph wind, ${r0(w.precipitationChance * 100)}% rain: teams lean on the run`, f: 1.03, ctx: true });
  else out.push({ k: "Weather", text: `${r0(w.temperatureF)}°F, ${r0(w.windMph)} mph wind: no real effect`, ctx: true });
  const lead = (isHome ? 1 : -1) * c.prediction.projectedMargin;
  if (Math.abs(lead) >= 3) {
    const run = stat === "rushing_yards";
    const up = run ? lead > 0 : lead < 0;   // leaders run late, trailers throw late
    out.push({ k: "Game flow", text: `His team is projected to ${lead > 0 ? "lead" : "trail"} by ${Math.abs(lead).toFixed(1)}: ${lead > 0 ? "more running late" : "more throwing late"}`, f: up ? 1.03 : 0.97, ctx: true });
  }
  const rest = isHome ? c.factors.home.rest : c.factors.away.rest;
  if (rest && (rest.daysRest <= 5 || (rest.timezonesCrossed ?? 0) >= 2))
    out.push({ k: "Schedule", text: `${rest.daysRest <= 5 ? `Short week (${rest.daysRest} days)` : ""}${rest.daysRest <= 5 && (rest.timezonesCrossed ?? 0) >= 2 ? ", " : ""}${(rest.timezonesCrossed ?? 0) >= 2 ? `${rest.timezonesCrossed} time zones of travel` : ""}`, f: 0.98, ctx: true });
  return out;
}
