"use client";
/**
 * Personal bets and the parlay slip. Both live in this browser's localStorage only: they don't sync to other devices
 * and are lost if site data is cleared. Every read/write is guarded, since storage can be blocked (private windows).
 *
 * Settling: spreads, totals and moneylines settle from final scores (results.json); props settle when the site has
 * graded the same prop (history.json). Anything else waits for a Won / Lost / Push tap.
 */
import { useCallback, useEffect, useState } from "react";
import type { GameResults, MatchupCardData, ParlayLeg, TrackedPick, ValueBet } from "@/types/sports";
import { parlayDecimal, toDecimal } from "@/lib/odds-math";

export type Result = "win" | "loss" | "push";

/** One selection: a straight bet, or a leg of a parlay. */
export interface Leg {
  id: string;
  matchupId: string;
  market: string;   // moneyline | spread | total | prop
  side: string;
  line?: number;
  label: string;
  game: string;
  league: string;
  start: string;
  americanOdds: number;
  modelProb?: number;
  result?: Result;
}

export interface MyBet extends Leg {
  kind?: "single" | "parlay";
  legs?: Leg[];
  stake: number;
  addedAt: string;
  /** true when the result came from final scores / the site's grading rather than a tap */
  auto?: boolean;
}

const KEY = "ea-my-bets-v1";
const SLIP = "ea-parlay-slip-v1";
const STAKE_KEY = "ea-my-stake";
const EVENT = "ea-my-bets";

function load<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]") as T[]; } catch { return []; }
}
function save<T>(key: string, v: T[]) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  window.dispatchEvent(new Event(EVENT));
}
export function lastStake(): number {
  try { return Number(localStorage.getItem(STAKE_KEY)) || 10; } catch { return 10; }
}
function rememberStake(x: number) {
  try { localStorage.setItem(STAKE_KEY, String(x)); } catch {}
}

/** Re-render on any change, in this tab or another. */
function useStored<T>(key: string): T[] {
  const [v, setV] = useState<T[]>([]);
  useEffect(() => {
    const sync = () => setV(load<T>(key));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, [key]);
  return v;
}

// ---------- legs from the site's data ----------

export function legFromBet(b: ValueBet, card?: MatchupCardData): Leg {
  const m = card?.matchup;
  return {
    id: b.id, matchupId: b.matchupId, market: b.market, side: b.side, line: b.line, label: b.label,
    game: m ? `${m.away.shortName} @ ${m.home.shortName}` : "", league: m?.league ?? "", start: m?.startTime ?? "",
    americanOdds: b.bestQuote.americanOdds, modelProb: b.modelProb,
  };
}

/** Parlay legs carry only a ref id: "<matchupId>:<market>:<side>:<line>" for game bets, a prop id otherwise. */
export function legFromParlayLeg(l: ParlayLeg, cards: Map<string, MatchupCardData>): Leg {
  const m = cards.get(l.matchupId)?.matchup;
  const parts = l.refId.split(":");
  const game = l.kind === "bet" && parts.length >= 4 && parts[0] === l.matchupId;
  return {
    id: l.refId, matchupId: l.matchupId, market: game ? parts[1] : "prop", side: game ? parts[2] : "",
    line: game && parts[3] !== "" ? Number(parts[3]) : undefined, label: l.label,
    game: m ? `${m.away.shortName} @ ${m.home.shortName}` : "", league: m?.league ?? "", start: m?.startTime ?? "",
    americanOdds: l.americanOdds, modelProb: l.modelProb,
  };
}

// ---------- the parlay slip ----------

/** Two legs that can't both win: opposite sides of the same market in one game. */
function conflicts(a: Leg, b: Leg): boolean {
  if (a.matchupId !== b.matchupId || a.market === "prop" || b.market === "prop") return false;
  const kind = (m: string) => (m === "alt_spread" ? "spread" : m === "alt_total" ? "total" : m);
  return kind(a.market) === kind(b.market) && a.side !== b.side;
}

export function useSlip() {
  const legs = useStored<Leg>(SLIP);
  const add = useCallback((leg: Leg): string | null => {
    const cur = load<Leg>(SLIP);
    if (cur.some((x) => x.id === leg.id)) return null;
    const clash = cur.find((x) => conflicts(x, leg));
    if (clash) return `Can't add ${leg.label}: it's the other side of ${clash.label}, so both can't win.`;
    if (cur.length >= 12) return "A parlay can have at most 12 legs.";
    save(SLIP, [...cur, leg]);
    return null;
  }, []);
  const remove = useCallback((id: string) => save(SLIP, load<Leg>(SLIP).filter((x) => x.id !== id)), []);
  const clear = useCallback(() => save(SLIP, []), []);
  const replace = useCallback((next: Leg[]) => save(SLIP, next), []);
  return { legs, add, remove, clear, replace, has: (id: string) => legs.some((x) => x.id === id) };
}

/** Parlay price and the model's chance, treating legs as independent. */
export function slipMath(legs: Leg[]) {
  const decimal = legs.length ? parlayDecimal(legs.map((l) => l.americanOdds)) : 1;
  const known = legs.every((l) => l.modelProb !== undefined);
  const hit = known ? legs.reduce((p, l) => p * l.modelProb!, 1) : null;
  const games = new Map<string, number>();
  for (const l of legs) games.set(l.matchupId, (games.get(l.matchupId) ?? 0) + 1);
  return { decimal, american: decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1)), hit, implied: 1 / decimal, sameGame: [...games.values()].some((n) => n > 1) };
}

// ---------- my bets ----------

export function profitOf(b: MyBet): number {
  if (b.result === "loss") return -b.stake;
  if (b.result !== "win") return 0;
  if (b.kind === "parlay" && b.legs) {
    // pushed legs drop out; the rest pay as a smaller parlay
    const live = b.legs.filter((l) => l.result !== "push");
    return b.stake * ((live.length ? parlayDecimal(live.map((l) => l.americanOdds)) : 1) - 1);
  }
  return b.stake * (toDecimal(b.americanOdds) - 1);
}

export function useMyBets() {
  const bets = useStored<MyBet>(KEY);

  const add = useCallback((b: ValueBet, card?: MatchupCardData) => {
    const bet: MyBet = { ...legFromBet(b, card), kind: "single", stake: lastStake(), addedAt: new Date().toISOString() };
    save(KEY, [bet, ...load<MyBet>(KEY).filter((x) => x.id !== b.id)]);
  }, []);
  /** Any selection (props, alt props) as a straight bet. */
  const addLeg = useCallback((leg: Leg) => {
    const bet: MyBet = { ...leg, result: undefined, kind: "single", stake: lastStake(), addedAt: new Date().toISOString() };
    save(KEY, [bet, ...load<MyBet>(KEY).filter((x) => x.id !== leg.id)]);
  }, []);
  const addParlay = useCallback((legs: Leg[], stake: number) => {
    const { american } = slipMath(legs);
    const starts = legs.map((l) => l.start).filter(Boolean).sort();
    const bet: MyBet = {
      id: `parlay:${Date.now()}`, kind: "parlay", legs: legs.map((l) => ({ ...l, result: undefined })),
      matchupId: "", market: "parlay", side: "", label: `${legs.length}-leg parlay`, game: legs.map((l) => l.label).join(" + "),
      league: [...new Set(legs.map((l) => l.league).filter(Boolean))].join(", "), start: starts[0] ?? "",
      americanOdds: american, stake, addedAt: new Date().toISOString(),
    };
    rememberStake(stake);
    save(KEY, [bet, ...load<MyBet>(KEY)]);
  }, []);
  const remove = useCallback((id: string) => save(KEY, load<MyBet>(KEY).filter((x) => x.id !== id)), []);
  const update = useCallback((id: string, patch: Partial<MyBet>) => {
    if (patch.stake !== undefined) rememberStake(patch.stake);
    save(KEY, load<MyBet>(KEY).map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  return { bets, add, addLeg, addParlay, remove, update, has: (id: string) => bets.some((x) => x.id === id) };
}

// ---------- automatic settling ----------

/** Spread / total / moneyline from a final score. */
/** Prop results the site publishes (prop-results.json), by prop id. */
export type PropResultMap = Record<string, { r: Result }>;

export function gradeLeg(l: Leg, results: GameResults, history: TrackedPick[], props: PropResultMap = {}): Result | undefined {
  const r = results[l.matchupId];
  const market = l.market === "alt_spread" ? "spread" : l.market === "alt_total" ? "total" : l.market;
  if (r && (market === "moneyline" || market === "spread" || market === "total")) {
    const line = l.line ?? 0;
    const d = market === "moneyline" ? (l.side === "home" ? r.home - r.away : l.side === "away" ? r.away - r.home : r.home === r.away ? 1 : -1)
      : market === "spread" ? (l.side === "home" ? r.home - r.away : r.away - r.home) + line
      : l.side === "over" ? r.home + r.away - line : line - (r.home + r.away);
    return d > 0 ? "win" : d < 0 ? "loss" : "push";
  }
  // props: only when the site graded the same prop
  if (props[l.id]) return props[l.id].r;   // official player stats, graded by the site
  const p = history.find((h) => h.id === `alt:${l.id}` && (h.result === "win" || h.result === "loss" || h.result === "push"));
  return p ? (p.result as Result) : undefined;
}

/** Results for open bets that can now be settled (parlays need every leg final, or any leg lost). */
export function autoGrade(bets: MyBet[], results: GameResults, history: TrackedPick[], props: PropResultMap = {}): { id: string; patch: Partial<MyBet> }[] {
  const out: { id: string; patch: Partial<MyBet> }[] = [];
  for (const b of bets) {
    if (b.result) continue;
    if (b.kind === "parlay" && b.legs) {
      const legs = b.legs.map((l) => ({ ...l, result: l.result ?? gradeLeg(l, results, history, props) }));
      const res: Result | undefined = legs.some((l) => l.result === "loss") ? "loss"
        : legs.every((l) => l.result) ? (legs.every((l) => l.result === "push") ? "push" : "win") : undefined;
      if (res || legs.some((l, i) => l.result !== b.legs![i].result)) out.push({ id: b.id, patch: { legs, ...(res ? { result: res, auto: true } : {}) } });
    } else {
      const res = gradeLeg(b, results, history, props);
      if (res) out.push({ id: b.id, patch: { result: res, auto: true } });
    }
  }
  return out;
}

