/**
 * "Our chance" ranking, shared by the site's lists (browser) and the Our Picks log (data build), so what the site shows
 * as most likely is exactly what gets tracked. No React here.
 */
import type { GradeInfo, MatchupCardData, PlayerProp, ValueBet } from "@/types/sports";
import { isMainLine } from "@/lib/live/openers";
import { impliedProb } from "@/lib/odds-math";

/** Most likely to hit: our chance at least this, at a price you'd play for consistency. */
export const LIKELY_MIN = 0.55;
/** -175 at the short end: week 1 of Our Picks went 11-9 at -200 or shorter and lost 4 units (you need 67% there). */
export const LIKELY_ODDS: [number, number] = [-175, 120];
/**
 * Logged picks (Our Picks, the parlay tracker) also need our chance to beat the price's break-even by this much.
 * 10/13 on Sports Plus: picks averaged -155 (60% needed) with our chance 61%, so they went 4-4 and lost 1.5 units.
 */
export const MIN_EDGE = 0.03;
/**
 * Our Picks take bets we rate 65%+ only. Through 10/14 across both sites, 65-75% picks went 45-22 (67% vs 60% needed,
 * +7.9u); 55-65% went 10-9 (-1.9u, the juice eats a near coin flip); 75%+ went 10-11 (overconfidence, since reined in).
 */
export const OURS_MIN = 0.65;
export const beatsPrice = (x: { our: number; odds: number }) => x.our - impliedProb(x.odds) >= MIN_EDGE;
/** Longshots: plus money up to this, where we like it 3+ points more than the books. */
export const LONGSHOT_ODDS: [number, number] = [121, 400];
/** When chances are close, the sportsbooks the user plays rank ahead of Kalshi rungs. */
export const kalshiHandicap = (book: string) => (book === "Kalshi" ? 0.03 : 0);
/** A model 25+ points from the market is missing news; no number beats a misleading one. */
export const sane = (our: number, books: number) => Math.abs(our - books) <= 0.25;
/**
 * Our chance, reined in toward the books: keep 25% of the model's disagreement. Week 1 the raw model said 73% on its
 * picks and they hit 55%, and its "75%+" picks went 8-10, so a big gap is mostly the model missing something.
 */
// 10/16: cut from 0.4. Our picks have hit at about the books' rate, not ours (football: model 73%, books 59%,
// hit 57%), so the books' price gets most of the weight and the model only nudges it.
export const SHRINK = 0.25;
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
  /** An alt line / alt prop (not the main line). */
  alt?: boolean;
  /** Props whose projection leans mostly on last season (this season's average is far from it): skipped by the Daily 5. */
  stale?: boolean;
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
        player: p.playerName, alt: !!p.isAlt || p.source === "kalshi", stale: p.flags?.includes("leans_last_season"), grade: { matchupId: m.id, market: "prop", side: p.side, line: p.line, ticker: p.ticker, player: p.playerName, stat: p.stat, ...base } });
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
  if (p.stat === "goals" && p.line === 0.5) return `${p.playerName} to score${p.side === "over" ? "" : ": no"} (anytime)`;
  return `${p.playerName} ${p.side === "over" ? "Over" : "Under"} ${p.line} ${p.statLabel.toLowerCase()}`;
}

export const likelyScore = (x: { our: number; book: string }) => x.our - kalshiHandicap(x.book);

/** One of the site's own parlays: a title and its legs (different games). */
export interface OurParlay { title: string; legs: Candidate[] }

/**
 * The site's own parlays for a slate, the same way the Parlays page builds its safest ones:
 *   Safest 2-leg / 3-leg: legs both we (63%+) and the books (58%+) like, best combined chance (average of the two)
 *   Moneyline parlay: teams we rate 55%+ to win at -400 to +120; three legs if they hit together 35%+, else two
 */
export function ourParlays(list: Candidate[]): OurParlay[] {
  const sure = (x: Candidate) => (likelyScore(x) + x.books) / 2;
  const best = (pool: Candidate[], n: number, score: (x: Candidate) => number): Candidate[] | null => {
    const top = [...pool].sort((a, b) => score(b) - score(a)).slice(0, 14);
    let bestC = null as Candidate[] | null, bestP = 0;
    const rec = (start: number, cur: Candidate[]) => {
      if (cur.length === n) { const p = cur.reduce((s, x) => s * score(x), 1); if (p > bestP) { bestP = p; bestC = [...cur]; } return; }
      for (let i = start; i < top.length; i++) if (!cur.some((c) => c.matchupId === top[i].matchupId)) rec(i + 1, [...cur, top[i]]);
    };
    rec(0, []);
    return bestC;
  };
  // every leg has to beat its own price too
  const strong = list.filter((x) => x.our >= 0.63 && x.books >= 0.58 && x.odds >= LIKELY_ODDS[0] && x.odds <= LIKELY_ODDS[1] && beatsPrice(x));
  const ml = list.filter((x) => x.grade.market === "moneyline" && x.our >= 0.55 && x.odds >= -400 && x.odds <= 120 && beatsPrice(x));
  const out: OurParlay[] = [];
  // on thin slates, fall back to every leg we rate 55%+ at a playable price so there's always a 2- and 3-leg
  const likely = list.filter((x) => x.our >= LIKELY_MIN && x.odds >= LIKELY_ODDS[0] && x.odds <= LIKELY_ODDS[1] && beatsPrice(x));
  const pool = new Set(strong.map((x) => x.matchupId)).size >= 3 ? strong : likely;
  const two = best(pool, 2, sure), three = best(pool, 3, sure);
  if (two) out.push({ title: "Safest 2-leg", legs: two });
  if (three) out.push({ title: "Safest 3-leg", legs: three });
  const m3 = best(ml, 3, (x) => x.our), m2 = best(ml, 2, (x) => x.our);
  const mlp = m3 && m3.reduce((s, x) => s * x.our, 1) >= 0.35 ? m3 : m2;
  if (mlp) out.push({ title: "Moneyline parlay", legs: mlp });
  return out;
}

/**
 * Lock parlays: heavy favorites both we and the books agree on, and only where our chance still beats the price
 * (a "lock" priced like a lock has no value, and a parlay multiplies the juice).
 *   legs: our chance 70%+, books 68%+, priced -150 to -400, our chance 2+ points over break-even, one per game
 *   2-leg: the pair most likely to hit together; 3-leg only if all three hit together 45%+
 */
export const LOCK_LEG = { our: 0.7, books: 0.68, odds: [-400, -150] as [number, number], edge: 0.02 };
export const isLockLeg = (x: { our?: number; books: number; odds: number }) => x.our !== undefined && x.our >= LOCK_LEG.our && x.books >= LOCK_LEG.books
  && x.odds >= LOCK_LEG.odds[0] && x.odds <= LOCK_LEG.odds[1] && x.our - impliedProb(x.odds) >= LOCK_LEG.edge;
/** The best 2-leg and (when strong enough) 3-leg lock parlays from a pool of rows with our chance and a game id. */
export function lockCombos<T extends { our?: number; books: number; odds: number }>(pool: T[], gameOf: (x: T) => string): T[][] {
  const best = new Map<string, T>();
  for (const x of pool.filter(isLockLeg)) { const g = gameOf(x), cur = best.get(g); if (!cur || x.our! > cur.our!) best.set(g, x); }
  const legs = [...best.values()].sort((a, b) => b.our! - a.our!).slice(0, 12);
  const p = (ls: T[]) => ls.reduce((s, x) => s * x.our!, 1);
  const out: T[][] = [];
  if (legs.length >= 2) out.push(legs.slice(0, 2));   // sorted by chance, so the top two are the likeliest pair
  if (legs.length >= 3 && p(legs.slice(0, 3)) >= 0.45) out.push(legs.slice(0, 3));
  return out;
}
export const lockParlays = (list: Candidate[]): OurParlay[] =>
  lockCombos(list, (x) => x.matchupId).map((legs) => ({ title: `Lock ${legs.length}-leg`, legs }));

/**
 * Daily 5: the bets we'd actually pick for the day: likely to hit, priced at least as well as the market's own
 * consensus (better prices first), our model agreeing, no props propped up by last season, spread across games and
 * sports. Score = our chance + 2 x the price edge over the consensus.
 *   bar: our chance 55%+, our chance 1+ point over the price's break-even, a price no worse than the consensus,
 *        -220 to +150 (the user is fine with -200 favorites)
 *   spread: one per player, at most 2 per game and 3 per league (counting what's already logged today)
 */
export const DAILY_N = 5;

/** A game's alt spread / alt total rungs (Kalshi ladders) as candidates, our chance the same way the Alt tab shows it. */
export function altLineCandidates(c: MatchupCardData): Candidate[] {
  const m = c.matchup;
  const base = { home: m.home.name, away: m.away.name, homeAbbr: m.home.abbreviation, awayAbbr: m.away.abbreviation, start: m.startTime };
  const out: Candidate[] = [];
  for (const b of c.altLadders ?? []) {
    const spread = b.market === "alt_spread";
    const team = b.side === "home" ? m.home.shortName : m.away.shortName;
    for (const r of b.altLines ?? []) {
      const books = r.marketProb ?? r.modelProb;
      if (books === undefined || r.modelOnlyProb === undefined || !sane(r.modelOnlyProb, books)) continue;
      out.push({ id: `${b.id}:${r.line}`, matchupId: m.id, kind: "line", alt: true, odds: r.americanOdds, book: r.bookmaker, books, our: ourChance(r.modelOnlyProb, books),
        label: spread ? `${team} ${r.line > 0 ? "+" : ""}${r.line} (alt)` : `${b.side === "over" ? "Over" : "Under"} ${r.line} (alt)`,
        grade: { matchupId: m.id, market: b.market, side: b.side, line: r.line, ...base } });
    }
  }
  return out;
}

/** Game pages alt tracker: a game's top 3 on its Alt tab, "Most likely" order (55%+, -175 to +120), one per player. */
export function gameAltThree(list: Candidate[], n = 3): Candidate[] {
  const players = new Set<string>(), out: Candidate[] = [];
  for (const x of list.filter((y) => y.alt && y.our >= LIKELY_MIN && y.odds >= LIKELY_ODDS[0] && y.odds <= LIKELY_ODDS[1]).sort((a, b) => likelyScore(b) - likelyScore(a))) {
    if (out.length >= n) break;
    const k = x.player ? x.player.toLowerCase() : `${x.grade.market}|${x.grade.side}`;
    if (players.has(k)) continue;
    players.add(k); out.push(x);
  }
  return out;
}

/** Most likely tracker: the top 3 a day from the "Most likely to hit" list (55%+, -175 to +120), one per game. */
export function likelyThree(list: Candidate[], already: Candidate[] = [], n = 3): Candidate[] {
  const games = new Set(already.map((x) => x.matchupId));
  const out: Candidate[] = [];
  for (const x of list.filter((y) => y.our >= LIKELY_MIN && y.odds >= LIKELY_ODDS[0] && y.odds <= LIKELY_ODDS[1]).sort((a, b) => likelyScore(b) - likelyScore(a))) {
    if (already.length + out.length >= n) break;
    if (games.has(x.matchupId)) continue;
    games.add(x.matchupId); out.push(x);
  }
  return out;
}

/** O/U tracker: the day's top 3 leans on main over/unders (game totals and main-line props) priced -135 to +115. */
export function ouThree(list: Candidate[], already: Candidate[] = [], n = 3): Candidate[] {
  const isOU = (x: Candidate) => !x.alt && (x.kind === "prop" ? x.grade.side === "over" || x.grade.side === "under" : x.grade.market === "total");
  const games = new Set(already.map((x) => `${x.matchupId}|${x.player ?? x.grade.market}`));
  const out: Candidate[] = [];
  for (const x of list.filter((y) => isOU(y) && y.odds >= -135 && y.odds <= 115 && y.our - y.books >= 0.02).sort((a, b) => (b.our - b.books) - (a.our - a.books))) {
    if (already.length + out.length >= n) break;
    const k = `${x.matchupId}|${x.player ?? x.grade.market}`;
    if (games.has(k)) continue;
    games.add(k); out.push(x);
  }
  return out;
}
export function dailyFive(list: Candidate[], leagueOf: (matchupId: string) => string, already: Candidate[] = [], n = DAILY_N): Candidate[] {
  const edgeOf = (x: Candidate) => x.our - impliedProb(x.odds);
  // price edge: how much better this price is than the market's own no-vig number (line shopping, the edge that has
  // actually held up). 10/17: picks whose only edge was the model (college sides, puck lines at a worse-than-market
  // price) are what kept losing, so a worse-than-consensus price is out and better prices rank first.
  const shopOf = (x: Candidate) => x.books - impliedProb(x.odds);
  const score = (x: Candidate) => x.our + 2 * shopOf(x) - kalshiHandicap(x.book);
  const pool = list.filter((x) => x.our >= 0.55 && x.odds >= -220 && x.odds <= 150 && edgeOf(x) >= 0.01 && shopOf(x) >= 0 && !x.stale)
    .sort((a, b) => score(b) - score(a));
  const perGame = new Map<string, number>(), perLeague = new Map<string, number>(), players = new Set<string>(), ids = new Set<string>();
  // one bet per game per market, whatever the line ("total" covers alt totals too), and one per player
  const slot = (x: Pick<Candidate, "matchupId" | "grade" | "player">) => x.player ? `${x.matchupId}|p|${x.player.toLowerCase()}` : `${x.matchupId}|${x.grade.market.replace("alt_", "")}`;
  const slots = new Set<string>();
  const take = (x: Candidate) => {
    slots.add(slot(x));
    perGame.set(x.matchupId, (perGame.get(x.matchupId) ?? 0) + 1);
    perLeague.set(leagueOf(x.matchupId), (perLeague.get(leagueOf(x.matchupId)) ?? 0) + 1);
    if (x.player) players.add(`${x.matchupId}:${x.player.toLowerCase()}`);
    ids.add(x.id);
  };
  already.forEach(take);
  const out: Candidate[] = [];
  for (const x of pool) {
    if (already.length + out.length >= n) break;
    if (ids.has(x.id) || slots.has(slot(x)) || (perGame.get(x.matchupId) ?? 0) >= 2 || (perLeague.get(leagueOf(x.matchupId)) ?? 0) >= 3) continue;
    if (x.player && players.has(`${x.matchupId}:${x.player.toLowerCase()}`)) continue;
    // never both sides of one line
    if (out.some((o) => o.matchupId === x.matchupId && o.grade.market === x.grade.market && o.grade.line === x.grade.line && o.player === x.player)) continue;
    take(x); out.push(x);
  }
  return out;
}

/** Our top picks for a slate: most likely to hit, at most `perGame` from one game and one per player (his best line). */
export function topPicks(list: Candidate[], n = 10, perGame = 3): Candidate[] {
  const pool = list.filter((x) => x.our >= OURS_MIN && x.odds >= LIKELY_ODDS[0] && x.odds <= LIKELY_ODDS[1] && beatsPrice(x)).sort((a, b) => likelyScore(b) - likelyScore(a));
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
