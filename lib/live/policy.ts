/**
 * Pick policy: what qualifies as a recommendation, how many per day, and which bet types are paused.
 * Shared by the builder (logging) and the assembler (what the board shows), so both always agree.
 */
import type { LeagueId, MarketType, TrackedPick, ValueBet } from "@/types/sports";
import { MODEL_VERSION } from "@/lib/engine/probability";
import { toDecimal } from "@/lib/odds-math";

export { MODEL_VERSION };

/**
 * Minimum edge: how far the best price beats the books' no-vig consensus, in probability points (1 pt is roughly
 * 2% EV at even money). College and women's/smaller leagues have thinner, softer markets, so the bar is higher.
 */
const THIN = new Set<LeagueId>(["NCAAF", "NCAAB", "NCAAW", "WNBA", "LIGUE1", "SERIEA", "LALIGA", "BUNDESLIGA", "MLS"]);
export const minEdge = (league: LeagueId) => (THIN.has(league) ? 0.015 : 0.01);
/** A consensus needs at least this many books pricing both sides; fewer and one book's error looks like value. */
export const MIN_BOOKS = 3;
/** Most game picks per game: two picks on one game are one correlated bet (or, worse, both sides of it). */
export const PER_GAME_CAP = 1;
/** Most alt props per game: a dozen unders on one game is one bet on a slow game, not twelve edges. */
export const PROPS_PER_GAME = 3;
/** Most logged straight bets (singles, alt lines, props) on one game, all types combined: one opinion, bet once or twice. */
export const GAME_EXPOSURE = 2;
/** Most picks per league per day on the board (and in the log). */
export const dailyCap = (league: LeagueId) => (league === "NCAAF" || league === "NCAAB" ? 5 : 8);

export const leagueOfId = (matchupId: string) => matchupId.split("-")[0] as LeagueId;

export function betTypeOf(league: LeagueId | string, market: MarketType | "parlay" | string): string {
  if (market === "parlay") return "parlays";
  const m = market === "moneyline" ? "moneylines" : market === "spread" ? "spreads" : market === "total" ? "totals"
    : market === "alt_spread" || market === "alt_total" ? "alt lines" : "props";
  return `${league} ${m}`;
}

/**
 * Longshot cap: board picks pay +250 at most unless the edge is big. The model leans toward big underdogs (4 of the
 * 10 picks on 10/5 were +235 to +685); those lose most of the time and swing the record far more than they add.
 */
export const MAX_DOG_ODDS = 250;
export const LONGSHOT_MIN_EDGE = 0.05;

/**
 * The one "is this a value bet?" rule every page uses (board, value bets, odds chips): enough edge, enough books behind
 * the fair price, no stale-looking gap, and no longshots past +250, where a 2-point edge reads as +30% EV but the fair
 * price itself is too uncertain to trust.
 */
export function isValueBet(b: ValueBet, league: LeagueId): boolean {
  return (b.marketBooks ?? 0) >= MIN_BOOKS && qualifies(b, league, new Set());
}

export function qualifies(b: ValueBet, league: LeagueId, paused: Set<string>): boolean {
  return b.edge >= minEdge(league) && !b.flags?.includes("large_gap") && !paused.has(betTypeOf(league, b.market))
    && (b.marketBooks === undefined || b.marketBooks >= MIN_BOOKS)
    && (b.bestQuote.americanOdds <= MAX_DOG_ODDS || b.edge >= LONGSHOT_MIN_EDGE);
}

/**
 * Auto-pause: if a bet type's last 30 picks (current model only) beat the closing price less than 35% of the time
 * (with at least 20 to judge), the market keeps moving against it, the clearest sign the edge isn't real.
 */
export function pausedTypes(history: TrackedPick[]): Set<string> {
  const byType = new Map<string, TrackedPick[]>();
  for (const p of history) {
    // locks are heavy favorites taken at about fair price on purpose, so beating the close isn't their test (10/17:
    // Sports Plus locks were 17-7, +1.2u, but beat the close 7 of 21 and got paused, and a paused list can't recover)
    if (p.modelVersion !== MODEL_VERSION || p.closingOdds == null || !p.betType || p.betType === "locks") continue;
    byType.set(p.betType, [...(byType.get(p.betType) ?? []), p]);
  }
  const out = new Set<string>();
  for (const [t, list] of byType) {
    const recent = list.sort((a, b) => b.placedAt.localeCompare(a.placedAt)).slice(0, 30);
    if (recent.length < 20) continue;
    const beat = recent.filter((p) => toDecimal(p.americanOdds) > toDecimal(p.closingOdds!)).length;
    if (beat / recent.length < 0.35) out.add(t);
  }
  return out;
}

/**
 * Locks: the likeliest straight bets that are priced at or near fair. Nothing is a real lock; these are the
 * picks that lose least often, and they pay little. They keep their own record, outside the main one.
 */
export const LOCK_MIN_PROB = 0.62;
/**
 * How far under the fair price a lock may be. Likely winners almost always carry the book's full margin, so "fair or
 * better" left 0-1 locks a day; within 1.5 pts is still less than a normal book's cut on one side.
 */
export const LOCK_MIN_EDGE = -0.015;
/** Shortest price a lock may be: past -400, one loss wipes out more than four wins. */
export const LOCK_MAX_JUICE = -400;
export const LOCKS_PER_DAY = 10;

/** One lock per game: the likeliest qualifying spread, total or moneyline. */
export function pickLocks(bets: ValueBet[], paused: Set<string>): ValueBet[] {
  if (paused.has("locks")) return [];
  const best = new Map<string, ValueBet>();
  for (const b of bets) {
    if (b.market !== "moneyline" && b.market !== "spread" && b.market !== "total") continue;
    if (b.modelProb < LOCK_MIN_PROB || b.edge < LOCK_MIN_EDGE || b.flags?.includes("large_gap") || b.bestQuote.americanOdds < LOCK_MAX_JUICE) continue;
    const ex = best.get(b.matchupId);
    if (!ex || b.modelProb > ex.modelProb) best.set(b.matchupId, b);
  }
  return [...best.values()].sort((a, b) => b.modelProb - a.modelProb).slice(0, LOCKS_PER_DAY);
}
