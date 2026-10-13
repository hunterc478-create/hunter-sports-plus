/**
 * "Our chance" ranking, shared by the site's lists (browser) and the Our Picks log (data build), so what the site shows
 * as most likely is exactly what gets tracked. No React here.
 */
import type { GradeInfo, MatchupCardData, PlayerProp, ValueBet } from "@/types/sports";
import { isMainLine } from "@/lib/live/openers";

/** Most likely to hit: our chance at least this, at a price you'd play for consistency. */
export const LIKELY_MIN = 0.55;
/** -175 at the short end: week 1 of Our Picks went 11-9 at -200 or shorter and lost 4 units (you need 67% there). */
export const LIKELY_ODDS: [number, number] = [-175, 120];
/** Longshots: plus money up to this, where we like it 3+ points more than the books. */
export const LONGSHOT_ODDS: [number, number] = [121, 400];
/** When chances are close, the sportsbooks the user plays rank ahead of Kalshi rungs. */
export const kalshiHandicap = (book: string) => (book === "Kalshi" ? 0.03 : 0);
/** A model 25+ points from the market is missing news; no number beats a misleading one. */
export const sane = (our: number, books: number) => Math.abs(our - books) <= 0.25;
/**
 * Our chance, reined in toward the books: keep 40% of the model's disagreement. Week 1 the raw model said 73% on its
 * picks and they hit 55%, and its "75%+" picks went 8-10, so a big gap is mostly the model missing something.
 */
export const SHRINK = 0.4;
export const ourChance = (raw: number, books: number) => books + SHRINK * (raw - books);

export function mainBet(c: MatchupCardData, market: "spread" | "total" | "moneyline", side: string): ValueBet | undefined {
  const all = [c.recommended, ...c.otherBets].filter((b) => b.market === market && b.side === side);
  return all.find((b) => isMainLine(c, b)) ?? [...all].sort((a, b) => (b.marketBooks ?? 0) - (a.marketBooks ?? 0))[0];
}

/** A bet with our chance, in a form the log can grade. */
export interface Candidate {
  id: string;
  matchupId: string;
  kind: "line" | "prop";
  label: string;
  odds: number;
  book: string;
  books: number;
  our: number;
  /** Props: the player, so a list takes one bet per player instead of three rungs of the same one. */
  player?: string;
  grade: GradeInfo;
}

/** Game lines (both sides of spread, total, moneyline) and props with our chance, for the given games. */
export function candidates(cards: MatchupCardData[], props: PlayerProp[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of cards) {
    const m = c.matchup;
    const base = { home: m.home.name, away: m.away.name, homeAbbr: m.home.abbreviation, awayAbbr: m.away.abbreviation, start: m.startTime };
    if (c.prediction.modelVersion !== "market") {
      for (const [market, side] of [["spread", "away"], ["spread", "home"], ["total", "over"], ["total", "under"], ["moneyline", "away"], ["moneyline", "home"]] as const) {
        const b = mainBet(c, market, side);
        if (!b || b.marketProb === undefined || b.modelOnlyProb === undefined || !sane(b.modelOnlyProb, b.marketProb)) continue;
        out.push({ id: b.id, matchupId: m.id, kind: "line", label: b.label, odds: b.bestQuote.americanOdds, book: b.bestQuote.bookmaker.name,
          books: b.marketProb, our: ourChance(b.modelOnlyProb, b.marketProb), grade: { matchupId: m.id, market, side, line: b.line, ...base } });
      }
    }
    for (const p of props) {
      if (p.matchupId !== m.id || p.ourProb === undefined || p.flags?.includes("large_gap")) continue;
      out.push({ id: p.id, matchupId: m.id, kind: "prop", label: propLabel(p), odds: p.bestQuote.americanOdds, book: p.bestQuote.bookmaker.name,
        books: p.source === "kalshi" ? p.impliedProb : p.modelProb, our: ourChance(p.ourProb, p.source === "kalshi" ? p.impliedProb : p.modelProb),
        player: p.playerName, grade: { matchupId: m.id, market: "prop", side: p.side, line: p.line, ticker: p.ticker, player: p.playerName, stat: p.stat, ...base } });
    }
  }
  // one per bet (Kalshi can list the same bet twice)
  const seen = new Set<string>();
  return out.filter((x) => !seen.has(x.id) && seen.add(x.id));
}

/** "George Kittle under 70 rec yds" for a Kalshi "70+" rung's No side; "Over 4.5 receptions" for book props. */
export function propLabel(p: PlayerProp): string {
  if (p.source === "kalshi") {
    if (p.side === "over") return `${p.playerName} ${p.statLabel}`;
    const stat = p.statLabel.replace(/^[\d.]+\+\s*/, "");
    return p.stat === "anytime_td" ? `${p.playerName} no TD` : `${p.playerName} under ${Math.ceil(p.line)} ${stat}`;
  }
  return `${p.playerName} ${p.side === "over" ? "Over" : "Under"} ${p.line} ${p.statLabel.toLowerCase()}`;
}

export const likelyScore = (x: { our: number; book: string }) => x.our - kalshiHandicap(x.book);

/** Our top picks for a slate: most likely to hit, at most `perGame` from one game and one per player (his best line). */
export function topPicks(list: Candidate[], n = 10, perGame = 3): Candidate[] {
  const pool = list.filter((x) => x.our >= LIKELY_MIN && x.odds >= LIKELY_ODDS[0] && x.odds <= LIKELY_ODDS[1]).sort((a, b) => likelyScore(b) - likelyScore(a));
  const per = new Map<string, number>();
  const players = new Set<string>();
  const out: Candidate[] = [];
  for (const x of pool) {
    if ((per.get(x.matchupId) ?? 0) >= perGame) continue;
    if (x.player) { const k = `${x.matchupId}:${x.player.toLowerCase()}`; if (players.has(k)) continue; players.add(k); }
    per.set(x.matchupId, (per.get(x.matchupId) ?? 0) + 1);
    out.push(x);
    if (out.length === n) break;
  }
  return out;
}
