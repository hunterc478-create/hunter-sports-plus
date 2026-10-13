/** Price the model against the market: edge, EV, Kelly and alt-line ladders. */
import type { AltLine, ConfidenceTier, LeagueId, MarketOutcome, Prediction, ValueBet } from "@/types/sports";
import { expectedValue, impliedProb, kellyFraction } from "@/lib/odds-math";
import { coverProb, overProb, tierOf } from "./probability";

export const EV_MIN_EDGE = Number(process.env.EV_MIN_EDGE ?? 1) / 100;

/** Model probability for a single market outcome. */
export function modelProbFor(outcome: MarketOutcome, pred: Prediction, league: LeagueId): number | null {
  switch (outcome.market) {
    case "moneyline":
      if (outcome.side === "home") return pred.homeWinProb;
      if (outcome.side === "away") return pred.awayWinProb;
      if (outcome.side === "draw") return pred.drawProb ?? null;
      return null;
    case "spread":
    case "alt_spread": {
      if (outcome.line == null) return null;
      const homeLine = outcome.side === "home" ? outcome.line : -outcome.line;
      const pHome = coverProb(pred, league, homeLine);
      return outcome.side === "home" ? pHome : 1 - pHome;
    }
    case "total":
    case "alt_total": {
      if (outcome.line == null) return null;
      const pOver = overProb(pred, league, outcome.line);
      return outcome.side === "over" ? pOver : 1 - pOver;
    }
    default:
      return null;
  }
}

/**
 * Consensus engine (consensus-v1): a bet's true chance is the sportsbooks' own no-vig consensus, and a pick is a
 * book paying more than that. The factor model gets no say in picks (it went 2-15 as a 30% nudge); it's kept as a
 * displayed lean. 0 here means "market only"; raise it only if the model check panel ever shows real skill.
 */
export const MODEL_WEIGHT = 0;

/**
 * `market` is the sportsbook consensus for this outcome: no-vig chance, the best non-outlier quote, and how many
 * books priced it. Without it (mock data) the raw model is used.
 */
export function toValueBet(outcome: MarketOutcome, pred: Prediction, league: LeagueId, rationale: string,
  market?: { fairProb: number; best: MarketOutcome["best"]; books: number }): ValueBet | null {
  const modelOnly = modelProbFor(outcome, pred, league);
  if (modelOnly == null) return null;
  const modelProb = market ? market.fairProb + MODEL_WEIGHT * (modelOnly - market.fairProb) : modelOnly;
  const best = market?.best ?? outcome.best;
  const odds = best.americanOdds;
  const implied = impliedProb(odds);
  const edge = modelProb - implied;
  // an edge this big against the books' own consensus is almost always a stale or mis-scraped price
  const bigGap = edge > LARGE_GAP;
  const why = market
    ? `${best.bookmaker.name} pays ${odds > 0 ? "+" : ""}${odds}; the ${market.books}-book consensus makes the fair price ${fairAmerican(market.fairProb)} (${pct(market.fairProb)}).`
      + (pred.modelVersion === "market" ? "" : ` Our stats model makes it ${pct(modelOnly)}, so it ${Math.abs(modelOnly - market.fairProb) < 0.02 ? "roughly agrees" : modelOnly > market.fairProb ? "leans the same way" : "leans against it"}${rationale ? ` (${rationale})` : ""}.`)
    : rationale;
  return {
    id: outcome.id,
    matchupId: outcome.matchupId,
    market: outcome.market,
    side: outcome.side,
    label: outcome.label,
    line: outcome.line,
    bestQuote: best,
    modelProb,
    impliedProb: implied,
    edge,
    expectedValue: expectedValue(modelProb, odds),
    kellyFraction: kellyFraction(modelProb, odds),
    // with the market as the source of truth, confidence is how many books stand behind the fair price
    confidence: market ? (market.books >= 7 ? "elite" : market.books >= 5 ? "high" : market.books >= 3 ? "medium" : "low") : blendConfidence(pred.confidenceTier, edge),
    rationale: bigGap ? `${why} The gap to the market is unusually large, so check injury and lineup news before betting.` : why,
    flags: bigGap ? ["large_gap"] : undefined,
    marketProb: market?.fairProb,
    modelOnlyProb: market ? modelOnly : undefined,
    marketBooks: market?.books,
    books: market ? [...outcome.quotes].sort((a, b) => impliedProb(a.americanOdds) - impliedProb(b.americanOdds)).map((q) => ({ name: q.bookmaker.name, odds: q.americanOdds })) : undefined,
  };
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const fairAmerican = (p: number) => { const q = Math.min(0.99, Math.max(0.01, p)); const a = q >= 0.5 ? Math.round(-100 * q / (1 - q)) : Math.round(100 * (1 - q) / q); return a > 0 ? `+${a}` : `${a}`; };

/** Disagreements this large usually mean the market knows something the model doesn't. */
export const LARGE_GAP = 0.1;

/** Price an alt-line ladder (alt spreads / alt totals) against the same projection. */
export function priceAltLadder(
  rungs: { line: number; americanOdds: number; bookmaker: string }[],
  kind: "spread_home" | "spread_away" | "over" | "under",
  pred: Prediction,
  league: LeagueId,
): AltLine[] {
  return rungs.map((r) => {
    let p: number;
    if (kind === "over" || kind === "under") {
      const o = overProb(pred, league, r.line);
      p = kind === "over" ? o : 1 - o;
    } else {
      const homeLine = kind === "spread_home" ? r.line : -r.line;
      const h = coverProb(pred, league, homeLine);
      p = kind === "spread_home" ? h : 1 - h;
    }
    return { ...r, modelProb: p, edge: p - impliedProb(r.americanOdds) };
  });
}

/** Rank by edge, but never let a low-confidence projection outrank a solid one on edge alone. */
export function rankValueBets(bets: ValueBet[]): ValueBet[] {
  const weight: Record<ConfidenceTier, number> = { elite: 1, high: 0.85, medium: 0.6, low: 0.35 };
  // Big gaps rank below clean ones: a 15-point "edge" is more often missing news than a gift.
  const score = (b: ValueBet) => Math.min(b.edge, LARGE_GAP) * weight[b.confidence] * (b.flags?.includes("large_gap") ? 0.5 : 1);
  return [...bets].filter((b) => b.edge >= EV_MIN_EDGE && !b.flags?.includes("large_gap")).sort((a, b) => score(b) - score(a));
}

function blendConfidence(modelTier: ConfidenceTier, edge: number): ConfidenceTier {
  const base = { low: 0.35, medium: 0.55, high: 0.7, elite: 0.82 }[modelTier];
  // A huge edge usually means missing information, not a gift: it slightly lowers confidence.
  const adj = edge > 0.12 ? -0.1 : edge > 0.04 ? 0.04 : 0;
  return tierOf(base + adj);
}
