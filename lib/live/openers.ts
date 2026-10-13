/**
 * Line movement: the first best price the site saw for each game side, kept in public/data/openers.json between runs.
 * Keyed by game + market + side (not line), so a total moving 45.5 -> 46.5 still reads as one market moving.
 */
import type { MatchupCardData, ValueBet } from "@/types/sports";
import type { LiveBundle } from "./assemble";
import { impliedProb } from "@/lib/odds-math";

export type Openers = Record<string, { line?: number; americanOdds: number; at: string }>;

const keyOf = (b: ValueBet) => `${b.matchupId}:${b.market}:${b.side}`;

/**
 * Only the main line (the one most books quote) is tracked; a stray book's line on the same side would otherwise read
 * as a market move. Moneylines have no line.
 */
export function isMainLine(c: MatchupCardData, b: ValueBet): boolean {
  if (b.market === "moneyline") return true;
  if (b.market === "total") return b.line !== undefined && b.line === c.marketLine?.total;
  if (b.market === "spread") {
    const m = c.marketLine?.margin;
    // NHL puck lines and MLB run lines: the favorite -1.5 / underdog +1.5 (books also list the reverse as an alt line)
    if (c.matchup.league === "NHL" || c.matchup.league === "MLB") {
      if (m === undefined) return false;
      const favorite = (b.side === "home") === (m > 0);
      return b.line === (favorite ? -1.5 : 1.5);
    }
    return m !== undefined && b.line === (b.side === "home" ? -m : m);
  }
  return false;
}

/** Stamp each main-line bet with its opener (recording new ones) and drop openers for games no longer on the board. */
export function applyOpeners(bundle: LiveBundle, prev: Openers, now: string): Openers {
  const next: Openers = {};
  for (const c of bundle.byDay.all.matchups)
    for (const b of [c.recommended, ...c.otherBets]) {
      if (!isMainLine(c, b)) continue;
      const k = keyOf(b);
      // puck/run lines never move off 1.5, so a different stored line is a bad opener (or the favorite flipped): restart it
      const fixed = b.market === "spread" && (c.matchup.league === "NHL" || c.matchup.league === "MLB");
      const old = prev[k] && !(fixed && prev[k].line !== b.line) ? prev[k] : undefined;
      next[k] = old ?? { line: b.line, americanOdds: b.bestQuote.americanOdds, at: now };
      // bet objects are shared by every day's slice (and its top picks and locks), so this covers the whole bundle
      b.opening = next[k];
    }
  return next;
}

/**
 * Has the market moved toward this bet since it opened? true = toward (the side got more expensive or the line got
 * harder), false = away, null = no real move.
 */
export function movedToward(b: ValueBet): boolean | null {
  const o = b.opening;
  if (!o) return null;
  if (o.line !== undefined && b.line !== undefined && o.line !== b.line) {
    const d = b.line - o.line;
    // spreads: a smaller number is harder to cover; overs: a higher total; unders: a lower total
    if (b.market === "spread") return d < 0;
    if (b.side === "over") return d > 0;
    if (b.side === "under") return d < 0;
    return null;
  }
  const move = impliedProb(b.bestQuote.americanOdds) - impliedProb(o.americanOdds);
  return Math.abs(move) < 0.01 ? null : move > 0;
}
