/** Price player props (main and alt lines) from a stat projection. */
import type { ConfidenceTier, OddsQuote, PlayerProjection, PlayerProp, PropStat } from "@/types/sports";
import { impliedProb, probOverNormal, probOverPoisson } from "@/lib/odds-math";

export const STAT_LABELS: Record<PropStat, string> = {
  points: "Points", rebounds: "Rebounds", assists: "Assists", points_rebounds_assists: "Pts+Reb+Ast", threes: "3-Pointers",
  passing_yards: "Passing Yds", rushing_yards: "Rushing Yds", receiving_yards: "Receiving Yds", receptions: "Receptions", passing_tds: "Passing TDs",
  anytime_td: "Anytime TD", strikeouts: "Strikeouts", hits: "Hits", total_bases: "Total Bases", shots_on_goal: "Shots on Goal",
  goals: "Goals", shots_on_target: "Shots on Target", aces: "Aces", significant_strikes: "Sig. Strikes",
};

/**
 * P(stat > line). Real player outcomes have fatter tails than a single normal/Poisson curve (blowouts, injuries,
 * one 70-yard catch), so this mixes in wider versions of the distribution: rare outcomes keep a realistic chance
 * and nothing is ever priced as a sure thing. Capped to [4%, 96%] so neither side ever reads as a lock.
 */
export function probOver(proj: PlayerProjection, line: number): number {
  let p: number;
  if (proj.distribution === "empirical" && proj.quantiles?.length) {
    p = empiricalOver(proj.quantiles, line / Math.max(proj.mean, 0.01));
  } else if (proj.distribution === "poisson") {
    p = 0.8 * probOverPoisson(proj.mean, line) + 0.1 * probOverPoisson(proj.mean * 0.55, line) + 0.1 * probOverPoisson(proj.mean * 1.5, line);
  } else {
    const sd = proj.stdDev ?? proj.mean * 0.3;
    p = 0.8 * probOverNormal(proj.mean, sd, line) + 0.2 * probOverNormal(proj.mean, sd * 2, line);
  }
  return Math.min(0.96, Math.max(0.04, p));
}

export function priceProp(input: {
  id: string; matchupId: string; playerId: string; playerName: string; team: string; position?: string;
  stat: PropStat; line: number; isAlt: boolean; side: "over" | "under"; quote: OddsQuote; projection: PlayerProjection;
  matchupNote?: string; confidence: ConfidenceTier;
}): PlayerProp {
  const pOver = probOver(input.projection, input.line);
  const modelProb = input.side === "over" ? pOver : 1 - pOver;
  const implied = impliedProb(input.quote.americanOdds);
  const edge = modelProb - implied;
  const dir = input.side === "over" ? "over" : "under";
  return {
    ...input,
    statLabel: STAT_LABELS[input.stat],
    bestQuote: input.quote,
    modelProb,
    impliedProb: implied,
    edge,
    rationale: `Projected ${input.projection.mean.toFixed(1)} ${STAT_LABELS[input.stat].toLowerCase()}, so ${dir} ${input.line} hits ${(modelProb * 100).toFixed(0)}% of the time vs ${(implied * 100).toFixed(0)}% implied.`,
  };
}

/** P(ratio > x) from ratios at evenly spaced percentiles ((i + 0.5) / n), interpolated. */
export function empiricalOver(q: number[], x: number): number {
  const n = q.length;
  if (x <= q[0]) return 1 - 0.5 / n;
  if (x >= q[n - 1]) return 0.5 / n;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (q[mid] <= x) lo = mid; else hi = mid; }
  const t = q[hi] === q[lo] ? 0 : (x - q[lo]) / (q[hi] - q[lo]);
  const cdf = (lo + 0.5 + t) / n;
  return 1 - cdf;
}
