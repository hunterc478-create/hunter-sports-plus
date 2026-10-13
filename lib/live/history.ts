/**
 * Transparency log: everything the board recommends is logged about two hours before start at the posted price,
 * its last pregame price is kept as the close, and it's graded automatically once the result is in.
 *   game picks + alt spreads/totals -> final score
 *   Kalshi props / rungs             -> Kalshi's own settled Yes/No
 *   sportsbook props                 -> nflverse player stats (usually posted within a day)
 *   parlays                          -> leg by leg (a push drops that leg)
 */
import type { GradeInfo, Matchup, MatchupCardData, PickResult, TrackedPick } from "@/types/sports";
import { decimalToAmerican, parlayDecimal } from "@/lib/odds-math";
import { settleProfit } from "@/lib/engine/track-record";
import type { LiveBundle } from "./assemble";
import { betTypeOf, GAME_EXPOSURE, MODEL_VERSION } from "./policy";
import { getJson } from "./http";
import { candidates, topPicks } from "@/lib/ours";
import { sameTeam, type Game } from "./registry";
import { dayKey } from "./day";
import { toNflverseAbbr, type NflPlayers } from "./players/nfl";

const GIVE_UP_DAYS = 5;   // anything still ungradable after this is voided

export async function updateHistory(prev: TrackedPick[], board: LiveBundle, cards: MatchupCardData[], games: Game[], now: Date, players: NflPlayers | null): Promise<TrackedPick[]> {
  const history = prev.map((p) => ({ ...p }));
  const byId = new Map(history.map((p) => [p.id, p]));
  const minsTo = (iso: string) => (new Date(iso).getTime() - now.getTime()) / 60_000;
  // log picks this close to the start: after NFL inactives come out (~90 min before kickoff), so a late scratch
  // drops out of the picks instead of being logged (runs are every 30 min, so picks land 40-70 min before kickoff)
  const windowMin = Number(process.env.LOG_WINDOW_MIN ?? 70);
  const inWindow = (iso: string) => { const m = minsTo(iso); return m > 0 && m <= windowMin; };
  const card = new Map(cards.map((c) => [c.matchup.id, c]));
  const add = (p: TrackedPick) => { history.push(p); byId.set(p.id, p); };
  const base = { placedAt: now.toISOString(), result: "pending" as PickResult, modelVersion: MODEL_VERSION };
  // What this model version has already logged per game, so a board that reshuffles every 30 minutes can't stack
  // a second side, a second rung or another prop on the same game/player.
  // Exposure is capped per game across every bet type: on 10/5 one result (Flyers +1.5) sat in a single, an alt line
  // and all four logged parlays, and cost -4.0 of the day's -4.1 units.
  const current = history.filter((p) => p.modelVersion === MODEL_VERSION && p.grade);
  const lineIn = new Set(current.filter((p) => p.kind === "single" || p.kind === "alt").map((p) => p.grade!.matchupId));   // one game line (single or alt) per game
  const propPlayers = new Set(current.filter((p) => p.kind === "prop").map((p) => `${p.grade!.matchupId}|${p.grade!.player}`));
  const exposure = new Map<string, number>();   // logged straight bets (singles, alt lines, props) per game
  const expose = (id: string) => exposure.set(id, (exposure.get(id) ?? 0) + 1);
  for (const p of current) if (p.kind !== "parlay") expose(p.grade!.matchupId);
  const parlayGames = new Set(current.filter((p) => p.kind === "parlay").flatMap((p) => (p.grade!.legs ?? []).map((l) => l.matchupId)));

  // Closing price: every pending single keeps the latest pregame best price at its own line, whether or not it's
  // still on the board (picks that fall off are usually the ones the market moved against).
  for (const p of history) {
    if (p.result !== "pending" || (p.kind !== "single" && p.kind !== "lock") || !p.grade) continue;
    const c = card.get(p.grade.matchupId);
    if (!c || minsTo(c.matchup.startTime) <= 0) continue;
    const cur = [c.recommended, ...c.otherBets].find((b) => b.market === p.grade!.market && b.side === p.grade!.side && b.line === p.grade!.line);
    if (cur) p.closingOdds = cur.bestQuote.americanOdds;
  }

  // the bundle only carries the whole slate ("all"), not per-day copies
  for (const d of [board.byDay.all]) {
    // 1) game picks that made the board
    for (const b of d.topPicks) {
      const c = card.get(b.matchupId);
      if (!c) continue;
      const id = `${b.matchupId}:${b.market}:${b.side}`;
      if (byId.has(id) || lineIn.has(b.matchupId) || (exposure.get(b.matchupId) ?? 0) >= GAME_EXPOSURE) continue;
      if (!inWindow(c.matchup.startTime)) continue;
      lineIn.add(b.matchupId);
      expose(b.matchupId);
      add({ ...base, id, league: c.matchup.league, kind: "single", label: `${b.label} (${c.matchup.away.shortName} @ ${c.matchup.home.shortName})`,
        americanOdds: b.bestQuote.americanOdds, units: 1, modelProb: b.modelProb, edgeAtPick: b.edge, betType: betTypeOf(c.matchup.league, b.market),
        grade: { matchupId: b.matchupId, market: b.market, side: b.side, line: b.line, home: c.matchup.home.name, away: c.matchup.away.name, start: c.matchup.startTime } });
    }
    // 2) recommended alt lines and alt props
    for (const a of d.altPicks ?? []) {
      const id = `alt:${a.id}`;
      const ex = byId.get(id);
      const start = a.grade?.start;
      if (!start) continue;
      if (ex) { if (ex.result === "pending" && minsTo(start) > 0) ex.closingOdds = a.americanOdds; continue; }
      if (!inWindow(start)) continue;
      if ((exposure.get(a.matchupId) ?? 0) >= GAME_EXPOSURE) continue;
      if (a.kind === "alt_prop") {
        const who = `${a.matchupId}|${a.grade?.player}`;
        if (propPlayers.has(who)) continue;
        propPlayers.add(who);
      } else {
        if (lineIn.has(a.matchupId)) continue;
        lineIn.add(a.matchupId);
      }
      expose(a.matchupId);
      add({ ...base, id, league: a.league, kind: a.kind === "alt_prop" ? "prop" : "alt", label: `${a.label} (${a.detail})`,
        americanOdds: a.americanOdds, units: 1, modelProb: a.modelProb, edgeAtPick: a.edge, betType: betTypeOf(a.league, a.kind === "alt_prop" ? "prop" : "alt_spread"), grade: a.grade });
    }
    // 2b) locks: one per game, on their own record (outside the exposure cap, which guards the main record)
    for (const b of d.locks ?? []) {
      const c = card.get(b.matchupId);
      if (!c) continue;
      const id = `lock:${b.matchupId}`;
      if (byId.has(id) || !inWindow(c.matchup.startTime)) continue;
      add({ ...base, id, league: c.matchup.league, kind: "lock", label: `${b.label} (${c.matchup.away.shortName} @ ${c.matchup.home.shortName})`,
        americanOdds: b.bestQuote.americanOdds, units: 1, modelProb: b.modelProb, edgeAtPick: b.edge, betType: "locks",
        grade: { matchupId: b.matchupId, market: b.market, side: b.side, line: b.line, home: c.matchup.home.name, away: c.matchup.away.name, start: c.matchup.startTime } });
    }
    // 3) the day's parlays, logged when their first leg is about to start: one per tier, and the first option in
    // that tier whose games aren't already riding on another logged parlay or a logged game line
    for (const p of d.parlays) {
      const legs = p.legs.map((l) => legGrade(l.refId, l.americanOdds, card, d.props));
      if (legs.some((l) => !l)) continue;
      const first = legs.map((l) => l!.start!).sort()[0];
      const id = first ? `parlay:${dayKey(first)}:${p.tier}` : "";
      if (byId.has(id) || !first || !inWindow(first)) continue;
      const games = [...new Set(p.legs.map((l) => l.matchupId))];
      if (games.some((g) => parlayGames.has(g) || lineIn.has(g))) continue;
      for (const g of games) parlayGames.add(g);
      add({ ...base, id, league: card.get(p.legs[0].matchupId)?.matchup.league ?? "NFL", kind: "parlay", label: `${p.title}: ${p.legs.map((l) => l.label).join(" + ")}`,
        americanOdds: p.combinedAmericanOdds, units: 0.5, modelProb: p.modelHitProb, edgeAtPick: p.modelHitProb - p.impliedHitProb, betType: "parlays",
        grade: { matchupId: p.legs[0].matchupId, market: "parlay", legs: legs.map((l) => l!) } });
    }
  }

  // 4) Our Picks: when a game enters the log window, log its top 3 "most likely to hit" bets,
  // 1 unit each at the best price. Its own record; games already logged aren't logged again.
  const oursIn = new Set(history.filter((p) => p.kind === "ours" && p.grade).map((p) => p.grade!.matchupId));
  const slate = cards.filter((c) => c.matchup.status === "scheduled" && inWindow(c.matchup.startTime) && !oursIn.has(c.matchup.id));
  if (slate.length) {
    for (const x of topPicks(candidates(slate, board.byDay.all.props), slate.length * 3, 3)) {
      const c = card.get(x.matchupId)!;
      const id = `ours:${x.id}`;
      if (byId.has(id)) continue;
      add({ ...base, id, league: c.matchup.league, kind: "ours", label: `${x.label} (${c.matchup.away.shortName} @ ${c.matchup.home.shortName})`,
        americanOdds: x.odds, units: 1, modelProb: x.our, edgeAtPick: x.our - x.books, betType: "our picks", grade: x.grade });
    }
  }

  // ---- grading ----
  const finals = games.filter((g) => g.matchup.status === "final" && g.matchup.score).map((g) => g.matchup);
  const findFinal = (gr: GradeInfo) => finals.find((m) => m.id === gr.matchupId)
    ?? finals.find((m) => gr.home && sameTeam(m.home.name, gr.home) && sameTeam(m.away.name, gr.away) && (!gr.start || Math.abs(new Date(m.startTime).getTime() - new Date(gr.start).getTime()) < 30 * 3600_000));
  const kalshiCache = new Map<string, Promise<PickResult | null>>();
  const kalshiResult = (ticker: string) => {
    if (!kalshiCache.has(ticker)) kalshiCache.set(ticker, (async () => {
      const r = await getJson<{ market?: { result?: string; status?: string } }>(`https://api.elections.kalshi.com/trade-api/v2/markets/${ticker}`);
      const res = r?.market?.result?.toLowerCase();
      return res === "yes" ? "win" : res === "no" ? "loss" : res === "void" || res === "all_no" ? "void" : null;
    })());
    return kalshiCache.get(ticker)!;
  };
  const gradeOne = async (gr: GradeInfo): Promise<PickResult | null> => {
    if (gr.market === "prop") {
      if (gr.ticker) {
        const r = await kalshiResult(gr.ticker);   // "win" means the Yes side settled
        if (r === null) return null;
        if (r === "void") return "void";
        return (r === "win") === (gr.side === "over") ? "win" : "loss";
      }
      const m = findFinal(gr);
      if (!m || !players || !gr.player || !gr.stat) return null;
      const teams = [toNflverseAbbr(gr.homeAbbr), toNflverseAbbr(gr.awayAbbr)];
      const v = players.actual(gr.player, gr.stat, teams, m.week);
      // the game's stats are in but he has none: he didn't play, and books void the bet
      if (v === null) return players.gamePosted(teams, m.week) ? "void" : null;
      const d = gr.side === "over" ? v - (gr.line ?? 0) : (gr.line ?? 0) - v;
      return d > 0 ? "win" : d < 0 ? "loss" : "push";
    }
    const m = findFinal(gr);
    return m ? gradeLine(m, gr) : null;
  };

  for (const p of history) {
    if (p.result !== "pending" || !p.grade) continue;
    let res: PickResult | null = null;
    if (p.grade.market === "parlay" && p.grade.legs) {
      for (const leg of p.grade.legs) if (!leg.result || leg.result === "pending") leg.result = (await gradeOne(leg)) ?? "pending";
      const rs = p.grade.legs.map((l) => l.result!);
      if (rs.includes("loss")) res = "loss";
      else if (!rs.includes("pending")) {
        const live = p.grade.legs.filter((l) => l.result === "win");
        if (!live.length) res = "push";
        else { res = "win"; p.americanOdds = decimalToAmerican(parlayDecimal(live.map((l) => l.americanOdds))); }
      }
    } else res = await gradeOne(p.grade);
    if (!res && (now.getTime() - new Date(p.placedAt).getTime()) / 86_400_000 > GIVE_UP_DAYS) res = "void";
    if (!res) continue;
    p.result = res;
    p.settledAt = now.toISOString();
    p.profitUnits = settleProfit(p);
  }
  return history.slice(-3000);
}

function gradeLine(m: Matchup, g: GradeInfo): PickResult {
  const { home, away } = m.score!;
  const line = g.line ?? 0;
  let d: number;
  if (g.market === "moneyline") d = g.side === "home" ? home - away : g.side === "away" ? away - home : home === away ? 1 : -1;
  else if (g.market === "spread" || g.market === "alt_spread") d = (g.side === "home" ? home - away : away - home) + line;
  else d = g.side === "over" ? home + away - line : line - (home + away);
  return d > 0 ? "win" : d < 0 ? "loss" : "push";
}

/** Rebuild what's needed to grade one parlay leg from its id. Bets: "<matchupId>:<market>:<side>:<line>". */
function legGrade(refId: string, americanOdds: number, cards: Map<string, MatchupCardData>, props: { id: string; matchupId: string; side: string; line: number; ticker?: string; playerName: string; stat: string }[]) {
  const prop = props.find((p) => p.id === refId);
  if (prop) {
    const c = cards.get(prop.matchupId);
    if (!c) return null;
    return { matchupId: prop.matchupId, market: "prop", side: prop.side, line: prop.line, ticker: prop.ticker, player: prop.playerName, stat: prop.stat,
      home: c.matchup.home.name, away: c.matchup.away.name, homeAbbr: c.matchup.home.abbreviation, awayAbbr: c.matchup.away.abbreviation, start: c.matchup.startTime, americanOdds };
  }
  const parts = refId.split(":");
  if (parts.length < 4) return null;
  const [matchupId, market, side, line] = parts;
  const c = cards.get(matchupId);
  if (!c) return null;
  return { matchupId, market, side, line: line === "" ? undefined : Number(line), home: c.matchup.home.name, away: c.matchup.away.name, start: c.matchup.startTime, americanOdds };
}

export const _dayKey = dayKey;
