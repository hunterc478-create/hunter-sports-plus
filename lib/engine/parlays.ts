/**
 * Multi-tier parlay generator.
 * Legs come from priced singles/props; cross-game legs are treated as independent,
 * same-game legs use a correlation factor so the hit probability isn't naively multiplied.
 */
import type { Parlay, ParlayLeg, ParlayTier, ParlayTierConfig, PlayerProp, ValueBet } from "@/types/sports";
import { decimalToAmerican, parlayDecimal } from "@/lib/odds-math";

export const PARLAY_TIERS: ParlayTierConfig[] = [
  { tier: "bankroll_builder", label: "Bankroll Builders", minLegs: 2, maxLegs: 3, minLegProb: 0.58, description: "Low risk: short-priced legs the model rates as favorites." },
  { tier: "value_booster", label: "Value Boosters", minLegs: 3, maxLegs: 4, minLegProb: 0.5, description: "Medium risk: the best positive-edge legs, one per game." },
  { tier: "lotto", label: "Lotto Parlays", minLegs: 4, maxLegs: 7, minLegProb: 0.38, description: "High reward: long odds built from fairly priced legs. Expect most to miss." },
  { tier: "same_game", label: "Same-Game Parlays", minLegs: 2, maxLegs: 4, minLegProb: 0.4, description: "Correlated legs from one game that tend to win together." },
];

export function toLeg(x: ValueBet | PlayerProp): ParlayLeg {
  const isProp = "playerName" in x;
  return {
    refId: x.id, kind: isProp ? "prop" : "bet", matchupId: x.matchupId,
    label: isProp
      ? x.source === "kalshi" ? `${x.playerName} ${x.side === "over" ? "" : "No: "}${x.statLabel}`.replace(/\s+/g, " ") : `${x.playerName} ${x.side === "over" ? "O" : "U"} ${x.line} ${x.statLabel}`
      : x.label,
    americanOdds: x.bestQuote.americanOdds, modelProb: x.modelProb,
  };
}

export function buildParlay(tier: ParlayTier, title: string, legs: ParlayLeg[], rationale: string, correlationFactor = 1): Parlay {
  const dec = parlayDecimal(legs.map((l) => l.americanOdds));
  const indep = legs.reduce((p, l) => p * l.modelProb, 1);
  const modelHitProb = Math.min(0.97, indep * correlationFactor);
  return {
    id: `${tier}-${legs.map((l) => l.refId).join("_")}`,
    tier, title, legs, rationale, correlationFactor,
    combinedAmericanOdds: decimalToAmerican(dec),
    modelHitProb,
    impliedHitProb: 1 / dec,
    expectedValue: modelHitProb * dec - 1,
  };
}

/** Parlays built per tier. The log tracks the first option per tier that doesn't overlap games it already has riding. */
export const PARLAYS_PER_TIER = 5;

/**
 * Auto-build several parlays per tier from the day's pool (one leg per game outside SGPs).
 * Each new parlay prefers games no parlay has used yet (across all tiers), so the options don't all ride on the
 * same leg: on 10/5 every tier's top parlay included Flyers +1.5 and all four lost together. Games repeat only once
 * the fresh ones run out. Leg counts cycle through the tier's range.
 */
export function generateParlays(pool: (ValueBet | PlayerProp)[], perTier = PARLAYS_PER_TIER): Parlay[] {
  const out: Parlay[] = [];
  const uses = new Map<string, number>();   // parlays each game already appears in, shared across tiers
  for (const cfg of PARLAY_TIERS.filter((t) => t.tier !== "same_game")) {
    const candidates = pool.filter((x) => x.modelProb >= cfg.minLegProb && x.edge >= 0 && !("flags" in x && x.flags?.includes("large_gap"))).sort((a, b) => b.edge - a.edge);
    const seen = new Set<string>();
    for (let k = 0; k < perTier * 3 && out.filter((p) => p.tier === cfg.tier).length < perTier; k++) {
      const size = cfg.maxLegs - (k % (cfg.maxLegs - cfg.minLegs + 1));
      // stable sort: least-used games first, best edge within the same use count
      const order = [...candidates].sort((a, b) => (uses.get(a.matchupId) ?? 0) - (uses.get(b.matchupId) ?? 0));
      const games = new Set<string>();
      const picked: (ValueBet | PlayerProp)[] = [];
      for (const c of order) {
        if (games.has(c.matchupId)) continue;
        games.add(c.matchupId);
        picked.push(c);
        if (picked.length === size) break;
      }
      if (picked.length < cfg.minLegs) break;
      const key = picked.map((c) => c.id).sort().join("|");
      for (const c of picked) uses.set(c.matchupId, (uses.get(c.matchupId) ?? 0) + 1);
      if (seen.has(key)) continue;
      seen.add(key);
      // keep the strongest legs first in the list
      out.push(buildParlay(cfg.tier, cfg.label, picked.sort((a, b) => b.edge - a.edge).map(toLeg), cfg.description));
    }
  }
  return out;
}
