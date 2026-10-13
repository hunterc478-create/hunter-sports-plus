/**
 * Matchup factor model.
 *
 * Turns MatchupFactors into an expected margin and total, then into win / cover / over probabilities.
 * Every adjustment is recorded as a FactorTrigger so the UI can explain the number.
 *
 * This is deliberately transparent rather than a black box. To plug in a trained model later, keep the
 * same signature: (factors, league) => Prediction, and keep emitting triggers for explainability.
 */
import type { FactorTrigger, LeagueId, MatchupFactors, Prediction, ConfidenceTier } from "@/types/sports";
import { LEAGUES } from "@/lib/leagues";
import { normCdf } from "@/lib/odds-math";
import { paramsFor } from "./sport-params";

export const MODEL_VERSION = "consensus-v1";

const shrink = (value: number, games: number, prior: number) => value * (games / (games + prior));

export function predict(factors: MatchupFactors, leagueId: LeagueId, opts: { neutralSite?: boolean; indoor?: boolean } = {}): Prediction {
  const league = LEAGUES[leagueId];
  const P = paramsFor(leagueId);
  const { home, away } = factors;
  const triggers: FactorTrigger[] = [];
  let margin = 0;
  let totalAdj = 0;

  // 1) Team strength, shrunk toward average when the sample is small.
  const hr = shrink(home.ratings.powerRating, home.ratings.sampleSize, P.prior);
  const ar = shrink(away.ratings.powerRating, away.ratings.sampleSize, P.prior);
  const strength = hr - ar;
  margin += strength;
  triggers.push({
    category: "ratings",
    label: "Team strength",
    detail: `Power ratings ${home.ratings.powerRating >= 0 ? "+" : ""}${home.ratings.powerRating.toFixed(1)} vs ${away.ratings.powerRating >= 0 ? "+" : ""}${away.ratings.powerRating.toFixed(1)} (sample-adjusted)`,
    marginImpact: strength,
    severity: Math.abs(strength) > P.marginSd * 0.25 ? "high" : Math.abs(strength) > P.marginSd * 0.1 ? "medium" : "low",
  });

  // 2) Venue
  if (!league.individual && !opts.neutralSite) {
    margin += P.homeEdge;
    triggers.push({ category: "venue", label: "Home advantage", detail: `Standard ${league.name} home edge`, marginImpact: P.homeEdge, severity: "low" });
  }

  // 3) Injuries: sum of each absent player's value, weighted by how likely they are to sit.
  const sitShare = { out: 1, doubtful: 0.75, questionable: 0.35, day_to_day: 0.3, probable: 0.1 } as const;
  const lost = (list: typeof home.injuries) => list.reduce((s, i) => s + i.impact * sitShare[i.status], 0);
  const homeLost = lost(home.injuries);
  const awayLost = lost(away.injuries);
  if (homeLost || awayLost) {
    const net = awayLost - homeLost;
    margin += net;
    const top = [...home.injuries.map((i) => ({ ...i, side: "home" })), ...away.injuries.map((i) => ({ ...i, side: "away" }))]
      .sort((a, b) => b.impact * sitShare[b.status] - a.impact * sitShare[a.status])
      .slice(0, 3)
      .map((i) => `${i.playerName} (${i.position}, ${i.status.replace("_", "-")})`)
      .join(", ");
    triggers.push({
      category: "injury",
      label: "Injuries",
      detail: top,
      marginImpact: net,
      totalImpact: -(homeLost + awayLost) * 0.35,
      severity: Math.abs(net) > P.marginSd * 0.15 ? "high" : "medium",
    });
    totalAdj -= (homeLost + awayLost) * 0.35;
  }

  // 4) Rest & schedule
  const restDiff = Math.max(-3, Math.min(3, home.rest.daysRest - away.rest.daysRest));
  let restEffect = restDiff * P.restPerDay;
  if (home.rest.backToBack) restEffect -= P.backToBackPenalty;
  if (away.rest.backToBack) restEffect += P.backToBackPenalty;
  if (Math.abs(restEffect) > 0.01) {
    margin += restEffect;
    triggers.push({
      category: "rest",
      label: "Rest & schedule",
      detail: `${home.rest.daysRest} days rest vs ${away.rest.daysRest}${away.rest.backToBack ? "; visitors on a back-to-back" : ""}${home.rest.backToBack ? "; home team on a back-to-back" : ""}`,
      marginImpact: restEffect,
      severity: Math.abs(restEffect) > 1 ? "medium" : "low",
    });
  }

  // 5) Travel
  const tz = away.rest.timezonesCrossed ?? 0;
  if (tz > 0 && P.travelPerTimezone) {
    const eff = tz * P.travelPerTimezone;
    margin += eff;
    triggers.push({
      category: "travel",
      label: "Travel",
      detail: `Visitors cross ${tz} time zone${tz > 1 ? "s" : ""}${away.rest.travelMiles ? `, about ${away.rest.travelMiles.toLocaleString()} miles` : ""}`,
      marginImpact: eff,
      severity: tz >= 2 ? "medium" : "low",
    });
  }

  // 6) Weather (outdoor football / baseball / soccer only)
  const w = factors.weather;
  if (w && !opts.indoor && ["football", "baseball", "soccer"].includes(league.sport)) {
    let t = 0;
    if (league.sport === "football") t -= Math.max(0, w.windMph - 15) * 0.3 + (w.precipitationChance >= 0.5 ? 1.5 : 0);
    if (league.sport === "baseball") t += (w.temperatureF - 70) * 0.025;
    if (league.sport === "soccer" && (w.precipitationChance >= 0.6 || w.windMph >= 20)) t -= 0.15;
    if (Math.abs(t) > 0.05) {
      totalAdj += t;
      triggers.push({
        category: "weather",
        label: "Weather",
        detail: `${Math.round(w.temperatureF)}°F, wind ${Math.round(w.windMph)} mph, ${Math.round(w.precipitationChance * 100)}% precipitation`,
        marginImpact: 0,
        totalImpact: t,
        severity: Math.abs(t) > 1 ? "high" : "medium",
      });
    }
  }

  // 7) Head-to-head: a light nudge only; small samples are mostly noise.
  const h2h = factors.headToHead;
  if (h2h && h2h.meetings >= 4) {
    const rate = (h2h.homeWins + 0.5 * (h2h.draws ?? 0)) / h2h.meetings;
    const eff = (rate - 0.5) * P.marginSd * 0.08;
    margin += eff;
    triggers.push({ category: "head_to_head", label: "Head-to-head", detail: `${h2h.homeWins}-${h2h.awayWins}${h2h.draws ? `-${h2h.draws}` : ""} in the last ${h2h.meetings} meetings`, marginImpact: eff, severity: "low" });
  }

  // Projected total from pace / efficiency, shrunk toward league average.
  // expected points: home = avg/2 + homeOffense - awayDefense, away = avg/2 + awayOffense - homeDefense
  const paceBlend = (home.ratings.offense ?? 0) - (away.ratings.defense ?? 0) + (away.ratings.offense ?? 0) - (home.ratings.defense ?? 0);
  const sample = Math.min(home.ratings.sampleSize, away.ratings.sampleSize);
  const projectedTotal = Math.max(0.5, P.avgTotal + shrink(paceBlend, sample, P.prior) + totalAdj);

  // Probabilities
  let homeWinProb: number;
  let drawProb: number | undefined;
  if (league.hasDraw) {
    const lh = Math.max(0.15, projectedTotal / 2 + margin / 2);
    const la = Math.max(0.15, projectedTotal / 2 - margin / 2);
    const pmf = (l: number, k: number) => (Math.exp(-l) * l ** k) / factorial(k);
    let ph = 0, pd = 0;
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
      const p = pmf(lh, i) * pmf(la, j);
      if (i > j) ph += p; else if (i === j) pd += p;
    }
    homeWinProb = ph;
    drawProb = pd;
  } else {
    homeWinProb = normCdf(margin / P.marginSd);
  }

  const confidence = scoreConfidence(sample, P.prior, triggers, factors);
  return {
    matchupId: factors.matchupId,
    generatedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    homeWinProb,
    awayWinProb: 1 - homeWinProb - (drawProb ?? 0),
    drawProb,
    projectedScore: { home: projectedTotal / 2 + margin / 2, away: projectedTotal / 2 - margin / 2 },
    projectedMargin: margin,
    projectedTotal,
    confidence,
    confidenceTier: tierOf(confidence),
    triggers: triggers.sort((a, b) => Math.abs(b.marginImpact) + Math.abs(b.totalImpact ?? 0) - (Math.abs(a.marginImpact) + Math.abs(a.totalImpact ?? 0))),
  };
}

/** P(home covers `homeLine`), e.g. homeLine = -3.5 means home must win by 4+. */
export function coverProb(pred: Prediction, leagueId: LeagueId, homeLine: number): number {
  const P = paramsFor(leagueId);
  return normCdf((pred.projectedMargin + homeLine) / P.marginSd);
}

/** P(game total goes over `line`). */
export function overProb(pred: Prediction, leagueId: LeagueId, line: number): number {
  const P = paramsFor(leagueId);
  return 1 - normCdf((line - pred.projectedTotal) / P.totalSd);
}

function scoreConfidence(sample: number, prior: number, triggers: FactorTrigger[], f: MatchupFactors): number {
  let c = 0.35 + 0.45 * (sample / (sample + prior)); // more games => more trust
  const questionable = [...f.home.injuries, ...f.away.injuries].filter((i) => i.status === "questionable" && i.impact >= 1).length;
  c -= questionable * 0.06; // unresolved key injuries add variance
  if (triggers.some((t) => t.category === "weather" && t.severity === "high")) c -= 0.05;
  return Math.max(0.05, Math.min(0.95, c));
}

export function tierOf(c: number): ConfidenceTier {
  return c >= 0.78 ? "elite" : c >= 0.62 ? "high" : c >= 0.45 ? "medium" : "low";
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
