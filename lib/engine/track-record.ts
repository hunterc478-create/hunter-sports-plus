import type { ModelCheck, TrackedPick, TrackRecordSummary } from "@/types/sports";
import { impliedProb, toDecimal } from "@/lib/odds-math";

/** Graded straight bets needed before the verdict says anything; below this, luck swamps skill. */
export const MODEL_CHECK_MIN = 50;
const BUCKETS: [string, number, number][] = [["Under 45%", 0, 0.45], ["45–55%", 0.45, 0.55], ["55–65%", 0.55, 0.65], ["65–75%", 0.65, 0.75], ["75%+", 0.75, 1.01]];

export function modelCheck(picks: TrackedPick[]): ModelCheck {
  const graded = picks.filter((p) => p.kind !== "parlay" && (p.result === "win" || p.result === "loss"));
  const wins = graded.filter((p) => p.result === "win").length;
  const expectedWins = graded.reduce((s, p) => s + p.modelProb, 0);
  const buckets = BUCKETS.map(([label, lo, hi]) => {
    const g = graded.filter((p) => p.modelProb >= lo && p.modelProb < hi);
    return { label, picks: g.length,
      predicted: g.length ? g.reduce((s, p) => s + p.modelProb, 0) / g.length : 0,
      actual: g.length ? g.filter((p) => p.result === "win").length / g.length : 0 };
  });
  const withClose = picks.filter((p) => p.kind !== "parlay" && p.result !== "pending" && p.result !== "void" && p.closingOdds != null);
  const moves = withClose.map((p) => impliedProb(p.closingOdds!) - impliedProb(p.americanOdds));
  // wins vs. expected, in standard deviations: past 2 either way is more than bad luck
  const sd = Math.sqrt(graded.reduce((s, p) => s + p.modelProb * (1 - p.modelProb), 0));
  const z = sd ? (wins - expectedWins) / sd : 0;
  return {
    picks: graded.length, wins, expectedWins, buckets,
    clvSample: withClose.length,
    beatCloseRate: withClose.length ? moves.filter((m) => m > 0.001).length / withClose.length : null,
    avgClvPts: withClose.length ? moves.reduce((s, m) => s + m, 0) / withClose.length : null,
    verdict: graded.length < MODEL_CHECK_MIN ? "too_early" : z < -2 ? "overconfident" : z > 2 ? "underconfident" : "on_track",
  };
}

export function settleProfit(p: TrackedPick): number {
  if (p.result === "win") return p.units * (toDecimal(p.americanOdds) - 1);
  if (p.result === "loss") return -p.units;
  return 0;
}

export function summarize(picks: TrackedPick[]): TrackRecordSummary {
  const settled = picks.filter((p) => p.result !== "pending" && p.result !== "void");
  const wagered = settled.reduce((s, p) => s + p.units, 0);
  const profit = settled.reduce((s, p) => s + (p.profitUnits ?? settleProfit(p)), 0);
  const withClose = settled.filter((p) => p.closingOdds != null);
  const beatClose = withClose.filter((p) => toDecimal(p.americanOdds) > toDecimal(p.closingOdds!)).length;
  const byTier: TrackRecordSummary["byTier"] = {};
  for (const p of settled) {
    const k = p.kind;
    byTier[k] ??= { picks: 0, wins: 0, roi: 0 };
    byTier[k].picks++;
    if (p.result === "win") byTier[k].wins++;
  }
  for (const k of Object.keys(byTier)) {
    const group = settled.filter((p) => p.kind === k);
    const w = group.reduce((s, p) => s + p.units, 0);
    byTier[k].roi = w ? group.reduce((s, p) => s + (p.profitUnits ?? settleProfit(p)), 0) / w : 0;
  }
  const byType: NonNullable<TrackRecordSummary["byType"]> = {};
  for (const p of settled) {
    const k = p.betType ?? (p.kind === "parlay" ? "parlays" : `${p.league} ${p.kind === "single" ? "game picks" : p.kind === "alt" ? "alt lines" : "props"}`);
    const t = (byType[k] ??= { picks: 0, wins: 0, losses: 0, roi: 0, clv: null });
    t.picks++;
    if (p.result === "win") t.wins++;
    if (p.result === "loss") t.losses++;
  }
  for (const k of Object.keys(byType)) {
    const group = settled.filter((p) => (p.betType ?? (p.kind === "parlay" ? "parlays" : `${p.league} ${p.kind === "single" ? "game picks" : p.kind === "alt" ? "alt lines" : "props"}`)) === k);
    const w = group.reduce((s, p) => s + p.units, 0);
    byType[k].roi = w ? group.reduce((s, p) => s + (p.profitUnits ?? settleProfit(p)), 0) / w : 0;
    const wc = group.filter((p) => p.closingOdds != null);
    byType[k].clv = wc.length ? wc.filter((p) => toDecimal(p.americanOdds) > toDecimal(p.closingOdds!)).length / wc.length : null;
  }
  return {
    byType,
    picks: settled.length,
    wins: settled.filter((p) => p.result === "win").length,
    losses: settled.filter((p) => p.result === "loss").length,
    pushes: settled.filter((p) => p.result === "push").length,
    unitsWagered: wagered,
    unitsProfit: profit,
    roi: wagered ? profit / wagered : 0,
    closingLineValueRate: withClose.length ? beatClose / withClose.length : 0,
    closingSample: withClose.length,
    byTier,
  };
}
