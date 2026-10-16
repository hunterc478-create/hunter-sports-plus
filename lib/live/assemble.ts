/**
 * Turns priced games into the day-by-day bundle the UI reads.
 * Used by both the live builder and the mock data, so the day picker behaves the same either way.
 */
import type { AltPick, TdCandidate, DashboardData, MatchupCardData, Parlay, PlayerProp, TrackedPick, ValueBet } from "@/types/sports";
import { rankValueBets } from "@/lib/engine/value";
import { buildParlay, generateParlays, toLeg } from "@/lib/engine/parlays";
import { modelCheck, summarize } from "@/lib/engine/track-record";
import { paramsFor } from "@/lib/engine/sport-params";
import { betTypeOf, dailyCap, leagueOfId, MODEL_VERSION, PER_GAME_CAP, pickLocks, PROPS_PER_GAME, qualifies } from "./policy";
import { kalshiPhrase, kalshiPropPhrase } from "@/lib/kalshi-terms";
import { expectedValue } from "@/lib/odds-math";
import { dayKey } from "./day";

export interface SourceStatus { name: string; ok: boolean; detail: string }

export interface LiveBundle {
  generatedAt: string;
  isMock: boolean;
  tz: string;
  todayKey: string;
  /** Day keys (YYYY-MM-DD) that have games, in order. "all" is always present in byDay. */
  days: string[];
  byDay: Record<string, DashboardData>;
  status: { sources: SourceStatus[]; notes: string[] };
  /** When player props were last pulled (they refresh once a day and are carried between updates). */
  propsLoadedAt?: string;
  /** Reasons behind each player projection, by "<matchupId>|<player>|<stat>" (shared by all of that player's lines). */
  propWhy?: Record<string, import("@/types/sports").WhyPart[]>;
  /** Game logs for the hit-rate charts: teams by "<league>:<ESPN id>", players by "<player>|<stat>". */
  teamLogs?: Record<string, import("./logs").TeamGame[]>;
  playerLogs?: Record<string, { w: number; o: string; v: number; t?: string; ls?: 1 }[]>;
}

export function assemble(opts: {
  cards: MatchupCardData[]; bets: ValueBet[]; props: PlayerProp[]; history: TrackedPick[];
  generatedAt: string; isMock: boolean; tz: string; status?: LiveBundle["status"]; propsLoadedAt?: string; paused?: Set<string>; tdDerby?: TdCandidate[];
}): LiveBundle {
  const { cards, bets, props, history, generatedAt, isMock, tz } = opts;
  const open = new Set(cards.filter((c) => c.matchup.status === "scheduled").map((c) => c.matchup.id));
  const dayOf = new Map(cards.map((c) => [c.matchup.id, dayKey(c.matchup.startTime, tz)]));
  const legacy = isMock ? [] : history.filter((p) => p.modelVersion !== MODEL_VERSION);
  const current = isMock ? history : history.filter((p) => p.modelVersion === MODEL_VERSION);
  // locks keep their own record so the main one stays comparable to earlier days
  // locks and Our Picks keep their own records
  const trackRecord = summarize(current.filter((p) => p.kind !== "lock" && p.kind !== "ours" && p.kind !== "ourparlay" && p.kind !== "lockparlay" && p.kind !== "daily5"));
  const parlayHist = history.filter((p) => p.kind === "ourparlay");
  const parlayRecord = parlayHist.length ? summarize(parlayHist) : undefined;
  const parlayPicks = [...parlayHist].sort((a, b) => b.placedAt.localeCompare(a.placedAt)).slice(0, 60);
  const d5 = history.filter((p) => p.kind === "daily5");
  const daily5Record = d5.length ? summarize(d5) : undefined;
  const daily5Picks = [...d5].sort((a, b) => b.placedAt.localeCompare(a.placedAt)).slice(0, 80);
  const lockHist = history.filter((p) => p.kind === "lockparlay");
  const lockParlayRecord = lockHist.length ? summarize(lockHist) : undefined;
  const lockParlayPicks = [...lockHist].sort((a, b) => b.placedAt.localeCompare(a.placedAt)).slice(0, 60);
  const ours = history.filter((p) => p.kind === "ours");
  const oursRecord = ours.length ? summarize(ours) : undefined;
  const oursCheck = ours.length ? modelCheck(ours) : undefined;
  const oursPicks = [...ours].sort((a, b) => b.placedAt.localeCompare(a.placedAt) || a.label.localeCompare(b.label)).slice(0, 150);
  const lockHistory = current.filter((p) => p.kind === "lock");
  const locksRecord = lockHistory.length ? summarize(lockHistory) : undefined;
  const check = modelCheck(current.filter((p) => p.kind !== "ours"));
  const straightRecord = summarize(current.filter((p) => p.kind === "single" || p.kind === "alt"));
  // the 10/13 fixes (juice cap 10/12, 3-point edge rule 10/13): judge each list on what it's done since
  const FIXED = "2026-10-13T05:00:00Z";
  const oursNew = ours.filter((p) => p.placedAt >= FIXED);
  const bestNew = current.filter((p) => (p.kind === "single" || p.kind === "alt" || p.kind === "prop") && p.placedAt >= FIXED);
  const oursRecordNew = oursNew.length ? summarize(oursNew) : undefined;
  const bestRecordNew = bestNew.length ? summarize(bestNew) : undefined;
  const legacyRecord = legacy.length ? summarize(legacy) : undefined;
  const paused = opts.paused ?? new Set<string>();
  const recentResults = [...history].filter((p) => p.result !== "pending" && p.kind !== "lock" && p.kind !== "ours" && (isMock || p.modelVersion === MODEL_VERSION)).sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? "")).slice(0, 25);

  const build = (filter: (matchupId: string) => boolean): DashboardData => {
    const dayCards = cards.filter((c) => filter(c.matchup.id)).sort((a, b) => a.matchup.startTime.localeCompare(b.matchup.startTime));
    const dayBets = bets.filter((b) => filter(b.matchupId) && open.has(b.matchupId));
    const dayProps = props.filter((p) => filter(p.matchupId) && open.has(p.matchupId));
    // board policy: league minimum edges, paused bet types, and a daily cap per league
    const perLeague = new Map<string, number>();
    const perGame = new Map<string, number>();
    const ranked = rankValueBets(dayBets).filter((b) => {
      const lg = leagueOfId(b.matchupId);
      if (!isMock && !qualifies(b, lg, paused)) return false;
      const n = perLeague.get(lg) ?? 0;
      if (!isMock && n >= dailyCap(lg)) return false;
      if ((perGame.get(b.matchupId) ?? 0) >= PER_GAME_CAP) return false;
      perLeague.set(lg, n + 1);
      perGame.set(b.matchupId, (perGame.get(b.matchupId) ?? 0) + 1);
      return true;
    });
    // Parlay legs: the board's picks plus every other fairly priced (edge >= 0) bet on an open game, so the
    // generator has enough games to build several distinct parlays per tier. Paused bet types stay out.
    const legPool = isMock ? ranked : dayBets.filter((b) => b.edge >= 0 && !paused.has(betTypeOf(leagueOfId(b.matchupId), b.market)));
    const parlays: Parlay[] = generateParlays([...legPool, ...dayProps.filter((p) => p.edge >= 0)]);
    parlays.push(...sameGameParlays(dayCards.filter((c) => open.has(c.matchup.id)), dayProps));
    return {
      // no alt line on a game that already has a board pick: same opinion, bet twice
      altPicks: altPicks(dayCards.filter((c) => open.has(c.matchup.id)), dayProps, 12, new Set(ranked.map((b) => b.matchupId))),
      tdDerby: (opts.tdDerby ?? []).filter((t) => filter(t.matchupId) && open.has(t.matchupId)).slice(0, 300),
      generatedAt, isMock, topPicks: ranked.slice(0, 10), matchups: dayCards,
      props: props.filter((p) => filter(p.matchupId)).sort((a, b) => b.edge - a.edge), parlays, trackRecord, legacyRecord, recentResults,
      locks: pickLocks(dayBets, paused), locksRecord, modelCheck: check, straightRecord, oursRecord, oursCheck, oursPicks, parlayRecord, parlayPicks, lockParlayRecord, lockParlayPicks, daily5Record, daily5Picks, oursRecordNew, bestRecordNew,
    };
  };

  const days = [...new Set(cards.map((c) => dayOf.get(c.matchup.id)!))].sort();
  const byDay: Record<string, DashboardData> = { all: build(() => true) };
  // (per-day copies skipped: every page filters the whole slate itself)
  return {
    generatedAt, isMock, tz, todayKey: dayKey(new Date(generatedAt), tz), days, byDay,
    status: opts.status ?? { sources: [], notes: [] },
    propsLoadedAt: opts.propsLoadedAt,
  };
}

/**
 * Same-game parlays: the day's strongest games, each with its best side/total pair, plus a prop from that game if
 * one is priced positively. Correlation isn't modeled from data yet, so the factor stays 1.0 and the UI says so.
 */
function sameGameParlays(cards: MatchupCardData[], props: PlayerProp[], limit = 3): Parlay[] {
  const out: Parlay[] = [];
  for (const c of [...cards].sort((a, b) => b.recommended.edge - a.recommended.edge)) {
    if (out.length === limit) break;
    const all = [c.recommended, ...c.otherBets].filter((b) => b.edge > 0 && !b.flags?.includes("large_gap"));
    const side = all.filter((b) => b.market === "moneyline" || b.market === "spread").sort((a, b) => b.edge - a.edge)[0];
    const total = all.filter((b) => b.market === "total").sort((a, b) => b.edge - a.edge)[0];
    const prop = props.filter((p) => p.matchupId === c.matchup.id && p.edge > 0).sort((a, b) => b.edge - a.edge)[0];
    const legs = [side, total, prop].filter(Boolean) as (ValueBet | PlayerProp)[];
    if (legs.length >= 2) {
      out.push(buildParlay("same_game", `${c.matchup.away.shortName} @ ${c.matchup.home.shortName} SGP`, legs.map(toLeg),
        "Best-priced side, total and prop from one of the day's strongest games. Correlation between these legs isn't modeled yet, so the hit chance treats them as independent."));
    }
  }
  return out;
}

/** Payout window for recommendations: nothing that risks $250+ to win $100, nothing longer than +200. */
export const ALT_MIN_ODDS = -250, ALT_MAX_ODDS = 200;

const pct0 = (p: number) => `${Math.round(p * 100)}%`;
const fmtLine = (x: number) => (x > 0 ? `+${x}` : `${x}`);

/**
 * Recommended alt plays: alt props and alt-line rungs that
 *   - pay something (between -250 and +200),
 *   - sit near the projection (within about 1.25 standard deviations),
 *   - beat the price by 3+ points with at least a 40% chance,
 * ranked by expected profit per dollar. Alt lines are priced from the sportsbooks' line nudged by the model, so a
 * plain disagreement about the game can't masquerade as an alt edge. At most one alt line per game and half the
 * list, so props get room. One prop per player/stat. Big gaps are excluded.
 */
export function altPicks(cards: MatchupCardData[], props: PlayerProp[], limit = 12, skipLines = new Set<string>()): AltPick[] {
  type Cand = AltPick & { near: boolean };
  const picks: Cand[] = [];
  const game = new Map(cards.map((c) => [c.matchup.id, c]));
  for (const p of props) {
    // Kalshi props are priced from our own player projections, not a sportsbook consensus, so the consensus engine
    // shows them on the props page but never recommends or logs them
    if (!p.isAlt || p.source === "kalshi" || p.flags?.includes("large_gap") || !game.has(p.matchupId)) continue;
    const c = game.get(p.matchupId)!;
    const sd = p.projection.stdDev ?? Math.sqrt(Math.max(p.projection.mean, 0.5));
    const statName = p.statLabel.replace(/^[\d.]+\+\s*/, "");
    const countStat = p.stat === "receptions" || p.stat === "anytime_td";
    const label = `${p.playerName} ${p.side === "over" ? p.statLabel
      : p.stat === "anytime_td" && p.line <= 0.5 ? "no TD"
      : countStat ? `${p.line - 0.5} or fewer ${statName}` : `under ${p.line + 0.5} ${statName}`}`.replace(/\s+/g, " ").trim();
    const typical = p.projection.median && Math.abs(p.projection.median - p.projection.mean) > 1 ? ` (a typical game is about ${p.projection.median.toFixed(0)}; big games pull the average up)` : "";
    picks.push({
      id: p.id, matchupId: p.matchupId, league: c.matchup.league, kind: "alt_prop", label,
      detail: `${c.matchup.away.shortName} @ ${c.matchup.home.shortName}`, americanOdds: p.bestQuote.americanOdds, book: p.bestQuote.bookmaker.name,
      modelProb: p.modelProb, impliedProb: p.impliedProb, edge: p.edge,
      why: `We make it ${pct0(p.modelProb)} vs ${pct0(p.impliedProb)} at ${p.bestQuote.bookmaker.name}'s price. Projects ${p.projection.mean.toFixed(1)} on average${typical}. ${p.matchupNote ?? ""}`.trim(),
      near: Math.abs(p.line - p.projection.mean) <= 1.25 * sd,
      kalshi: kalshiPropPhrase(p.playerName, p.statLabel, p.side),
      grade: { matchupId: p.matchupId, market: "prop", side: p.side, line: p.line, ticker: p.ticker, player: p.playerName, stat: p.stat,
        home: c.matchup.home.name, away: c.matchup.away.name, homeAbbr: c.matchup.home.abbreviation, awayAbbr: c.matchup.away.abbreviation, start: c.matchup.startTime },
    });
  }
  for (const c of cards) {
    if (skipLines.has(c.matchup.id)) continue;
    const P = paramsFor(c.matchup.league);
    const H = c.matchup.home.shortName, Aw = c.matchup.away.shortName;
    const fav = (margin: number) => (Math.abs(margin) < 0.25 ? "a pick'em" : `${margin > 0 ? H : Aw} by ${Math.abs(margin).toFixed(1)}`);
    for (const lad of c.altLadders ?? []) for (const r of lad.altLines ?? []) {
      if (r.edge > 0.1) continue;
      const isTotal = lad.market === "alt_total";
      const team = isTotal ? "" : c.matchup[lad.side as "home" | "away"].shortName;
      const label = isTotal ? `${lad.side === "over" ? "Over" : "Under"} ${r.line}` : `${team} ${fmtLine(r.line)}`;
      const dist = isTotal ? Math.abs(r.line - c.prediction.projectedTotal) / P.totalSd
        : Math.abs((lad.side === "home" ? -r.line : r.line) - c.prediction.projectedMargin) / P.marginSd;
      const what = isTotal ? `${lad.side === "over" ? "Over" : "Under"} ${r.line}`
        : r.line < 0 ? `${team} winning by ${Math.abs(r.line) + 0.5} or more` : `${team} winning, or losing by ${r.line - 0.5} or fewer`;
      const basis = isTotal
        ? `Sportsbooks' total is ${c.marketLine?.total ?? "n/a"}; the model projects ${c.prediction.projectedTotal.toFixed(1)}.`
        : `Sportsbooks have it ${c.marketLine?.margin === undefined ? "n/a" : fav(c.marketLine.margin)}; the model has it ${fav(c.prediction.projectedMargin)}.`;
      picks.push({
        id: `${lad.id}:${r.line}`, matchupId: c.matchup.id, league: c.matchup.league, kind: isTotal ? "alt_total" : "alt_spread",
        label: `${label} (alt)`, detail: `${Aw} @ ${H}`, americanOdds: r.americanOdds, book: r.bookmaker,
        modelProb: r.modelProb, impliedProb: r.modelProb - r.edge, edge: r.edge,
        why: `We make ${what} ${pct0(r.modelProb)} vs ${pct0(r.modelProb - r.edge)} at Kalshi's price. ${basis} Our chance comes from the sportsbook consensus line${c.matchup.league === "NFL" ? ", stretched to this line with real NFL results vs. the line since 2010" : ""}.`,
        near: dist <= 1.25,
        kalshi: kalshiPhrase(lad.market, lad.side, r.line, c.matchup.home.shortName, c.matchup.away.shortName) ?? undefined,
        grade: { matchupId: c.matchup.id, market: lad.market, side: lad.side, line: r.line, home: c.matchup.home.name, away: c.matchup.away.name, start: c.matchup.startTime },
      });
    }
  }
  const ev = (p: AltPick) => expectedValue(p.modelProb, p.americanOdds);
  const ok = picks.filter((p) => p.near && p.edge >= 0.03 && p.modelProb >= 0.4 && p.americanOdds >= ALT_MIN_ODDS && p.americanOdds <= ALT_MAX_ODDS).sort((a, b) => ev(b) - ev(a));
  const seen = new Set<string>();
  const propsIn = new Map<string, number>();
  const out: AltPick[] = [];
  let lines = 0;
  const maxLines = Math.ceil(limit / 2);
  for (const p of ok) {
    // one prop per player (his receptions and yards unders are the same bet), one alt line per game
    const key = p.kind === "alt_prop" ? `${p.matchupId}|${p.grade?.player ?? p.label.split(" ").slice(0, 2).join(" ")}` : `${p.matchupId}|line`;
    if (seen.has(key)) continue;
    if (p.kind !== "alt_prop" && lines >= maxLines) continue;
    if (p.kind === "alt_prop" && (propsIn.get(p.matchupId) ?? 0) >= PROPS_PER_GAME) continue;
    seen.add(key);
    if (p.kind !== "alt_prop") lines++;
    else propsIn.set(p.matchupId, (propsIn.get(p.matchupId) ?? 0) + 1);
    const { near: _near, ...rest } = p;
    out.push(rest);
    if (out.length === limit) break;
  }
  return out;
}
