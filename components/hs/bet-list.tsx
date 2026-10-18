"use client";
/**
 * Ranked bet lists built on OUR chance (game model: matchup, injuries, weather, travel, rest; player projections for
 * props), shown next to the books' chance. Three views:
 *   likely    our chance 55%+, odds -250 to +120, most likely first
 *   likemore  same pool, ranked by how much higher our chance is than the books'
 *   longshots +121 to +400 where our chance is 3+ points over the books'
 */
import { useEffect, useState } from "react";
import type { AltPick, MatchupCardData, PlayerProp, ValueBet } from "@/types/sports";
import { gradeLeg, legFromBet, useMyBets, useSlip, type Leg, type PropResultMap, type Result } from "@/lib/my-bets";
import { kickoff } from "@/lib/nfl";
import { kalshiHandicap, LIKELY_MIN, LIKELY_ODDS, LONGSHOT_ODDS, mainBet, ourChance, propLabel, sane } from "@/lib/ours";
import { cn, fmtAmerican } from "@/lib/utils";
import { TrackButton } from "@/components/dashboard/track-button";
import { propWhyFor, WhyButton } from "./why";
import { HitChartButton } from "./hit-chart";

export interface BetRow {
  key: string;
  card: MatchupCardData;
  kind: "Spread" | "Total" | "Moneyline" | "Prop" | "Alt prop";
  label: string;
  odds: number;
  book: string;
  /** The books' chance: no-vig consensus when there is one, else the best price's implied chance. */
  books: number;
  /** Our chance, when the model has something to say. */
  our?: number;
  why?: string;
  bet?: ValueBet;
  leg: Leg;
  /** Props: where the player's projection reasons live ("<matchupId>|<player>|<stat>"). */
  whyKey?: string;
  /** An alt spread/total rung (not the main line). */
  alt?: boolean;
  /** Best price list: how many points this price beats the market's own no-vig number by. */
  priceEdge?: number;
}

/**
 * Best price picks as rows: the bets the value log takes (one book's price beats the other books' no-vig consensus),
 * game lines from the board's top picks plus alt lines / alt props, biggest price edge first.
 */
export function bestPriceRows(top: ValueBet[], alts: AltPick[], cards: MatchupCardData[]): BetRow[] {
  const byId = new Map(cards.map((c) => [c.matchup.id, c]));
  const kindOf = (m: string): BetRow["kind"] => (m.includes("spread") ? "Spread" : m.includes("total") ? "Total" : m === "moneyline" ? "Moneyline" : "Alt prop");
  const rows: BetRow[] = [];
  for (const b of top) {
    const c = byId.get(b.matchupId);
    if (!c || c.matchup.status !== "scheduled") continue;
    const books = b.marketProb ?? b.modelProb;
    rows.push({ key: b.id, card: c, kind: kindOf(b.market), label: b.label, odds: b.bestQuote.americanOdds, book: b.bestQuote.bookmaker.name, books,
      bet: b, leg: legFromBet(b, c), priceEdge: b.edge, alt: b.market.startsWith("alt_") });
  }
  for (const a of alts) {
    const c = byId.get(a.matchupId);
    if (!c || c.matchup.status !== "scheduled") continue;
    const g = a.grade;
    const leg: Leg = { id: a.id, matchupId: a.matchupId, market: g?.market ?? a.kind, side: g?.side ?? "", line: g?.line, label: a.label, game: gameName(c), league: c.matchup.league,
      start: c.matchup.startTime, americanOdds: a.americanOdds, modelProb: a.modelProb };
    rows.push({ key: `alt:${a.id}`, card: c, kind: kindOf(a.kind), label: a.label, odds: a.americanOdds, book: a.book, books: a.modelProb, leg, priceEdge: a.edge,
      alt: a.kind !== "alt_prop", whyKey: a.kind === "alt_prop" && g?.player && g?.stat ? `${a.matchupId}|${g.player}|${g.stat}` : undefined });
  }
  return rows.sort((x, y) => (y.priceEdge ?? 0) - (x.priceEdge ?? 0));
}

/** PrizePicks: a 2-pick Power Play pays 3x, so each pick needs about 58% (the cube root of 1/5 for 3-pick 5x is about 58.5%). */
export const PP_MIN = 0.58;

export type View = "likely" | "likemore" | "longshots";
export const VIEWS: [View, string][] = [["likely", "Most likely to hit"], ["likemore", "We like more than the books"], ["longshots", "Longshots worth a look"]];

const whyOfGame = (c: MatchupCardData) => c.prediction.triggers
  .filter((t) => t.category !== "venue" && t.label !== "League calibration" && t.label !== "Market consensus")
  .slice(0, 3).map((t) => `${t.label}: ${t.detail}`).join(" · ");

const gameName = (c: MatchupCardData) => `${c.matchup.away.shortName} @ ${c.matchup.home.shortName}`;

/** Both sides of the main spread, total and moneyline (plus the draw) for one game. */
export function lineRows(c: MatchupCardData): BetRow[] {
  const picks: [ValueBet | undefined, BetRow["kind"]][] = [
    [mainBet(c, "spread", "away"), "Spread"], [mainBet(c, "spread", "home"), "Spread"],
    [mainBet(c, "total", "over"), "Total"], [mainBet(c, "total", "under"), "Total"],
    [mainBet(c, "moneyline", "away"), "Moneyline"], [mainBet(c, "moneyline", "home"), "Moneyline"],
  ];
  const modelGame = c.prediction.modelVersion !== "market";
  const why = whyOfGame(c);
  return picks.filter((p): p is [ValueBet, BetRow["kind"]] => !!p[0] && p[0].marketProb !== undefined).map(([b, kind]) => {
    const books = b.marketProb!;
    const raw = modelGame && b.modelOnlyProb !== undefined && sane(b.modelOnlyProb, books) ? b.modelOnlyProb : undefined;
    const our = raw !== undefined ? ourChance(raw, books) : undefined;
    return { key: b.id, card: c, kind, label: b.label, odds: b.bestQuote.americanOdds, book: b.bestQuote.bookmaker.name, books, our, why: why || undefined, bet: b, leg: legFromBet(b, c) };
  });
}

/** Alt spread and total rungs (Kalshi ladders) for one game, with our chance from the game model. */
export function altLineRows(c: MatchupCardData): BetRow[] {
  const out: BetRow[] = [];
  const m = c.matchup;
  for (const b of c.altLadders ?? []) {
    const spread = b.market === "alt_spread";
    const team = b.side === "home" ? m.home.shortName : m.away.shortName;
    for (const r of b.altLines ?? []) {
      const books = r.marketProb ?? r.modelProb;
      if (books === undefined) continue;
      const raw = r.modelOnlyProb !== undefined && sane(r.modelOnlyProb, books) ? r.modelOnlyProb : undefined;
      const label = spread ? `${team} ${r.line > 0 ? "+" : ""}${r.line} (alt)` : `${b.side === "over" ? "Over" : "Under"} ${r.line} (alt)`;
      const id = `${b.id}:${r.line}`;
      const leg: Leg = { id, matchupId: m.id, market: b.market, side: b.side, line: r.line, label, game: gameName(c), league: m.league,
        start: m.startTime, americanOdds: r.americanOdds, modelProb: raw };
      out.push({ key: id, card: c, kind: spread ? "Spread" : "Total", label, odds: r.americanOdds, book: r.bookmaker, books,
        our: raw !== undefined ? ourChance(raw, books) : undefined, leg, alt: true });
    }
  }
  return out;
}

export function propRows(props: PlayerProp[], cards: MatchupCardData[]): BetRow[] {
  const byId = new Map(cards.map((c) => [c.matchup.id, c]));
  return props.filter((p) => !p.flags?.includes("large_gap") && byId.has(p.matchupId)).map((p) => {
    const c = byId.get(p.matchupId)!;
    const label = propLabel(p);
    const leg: Leg = { id: p.id, matchupId: p.matchupId, market: "prop", side: p.side, line: p.line, label, game: gameName(c), league: c.matchup.league,
      start: c.matchup.startTime, americanOdds: p.bestQuote.americanOdds, modelProb: p.ourProb ?? p.modelProb };
    return { key: p.id, card: c, kind: p.isAlt || p.source === "kalshi" ? "Alt prop" as const : "Prop" as const, label,
      odds: p.bestQuote.americanOdds, book: p.bestQuote.bookmaker.name, books: p.source === "kalshi" ? p.impliedProb : p.modelProb,
      our: p.ourProb !== undefined ? ourChance(p.ourProb, p.source === "kalshi" ? p.impliedProb : p.modelProb) : undefined, why: p.why, leg,
      whyKey: `${p.matchupId}|${p.playerName}|${p.stat}` };
  });
}

/**
 * Apply a view's filter and ranking. When chances are close, bets at the sportsbooks the user plays (FanDuel, Fliff,
 * DraftKings...) rank ahead of Kalshi rungs: a 3-point handicap on Kalshi, so it shows up but doesn't crowd the top.
 */
export function rank(rows: BetRow[], view: View): BetRow[] {
  // one row per bet: a repeated key makes React duplicate rows each time the list re-sorts (switching tabs)
  const seen = new Set<string>();
  const unique = rows.filter((r) => !seen.has(r.key) && seen.add(r.key));
  const ours = unique.filter((r): r is BetRow & { our: number } => r.our !== undefined);
  const k = (r: BetRow) => kalshiHandicap(r.book);
  const likeMore = (r: BetRow & { our: number }) => r.our - r.books - k(r);
  if (view === "longshots")
    return ours.filter((r) => r.odds >= LONGSHOT_ODDS[0] && r.odds <= LONGSHOT_ODDS[1] && r.our >= 0.25 && r.our - r.books >= 0.03).sort((a, b) => likeMore(b) - likeMore(a));
  const pool = ours.filter((r) => r.our >= LIKELY_MIN && r.odds >= LIKELY_ODDS[0] && r.odds <= LIKELY_ODDS[1]);
  return view === "likely" ? pool.sort((a, b) => (b.our - k(b)) - (a.our - k(a)))
    : pool.filter((r) => r.our > r.books).sort((a, b) => likeMore(b) - likeMore(a));
}

/** The first reason only: "244 receiving yards in 4 games this season (61.0 a game...)" -> short and scannable. */
const shortWhy = (w?: string) => {
  if (!w) return undefined;
  const first = w.split(/;\s|\.\s(?=[A-Z])|\s·\s/)[0].trim();
  return first.length > 110 ? `${first.slice(0, 107).trimEnd()}…` : first;
};

export function ViewTabs({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist">
      {VIEWS.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={view === k} type="button" onClick={() => onChange(k)}
          className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold", view === k ? "border-brand bg-brand text-obsidian" : "border-slate-line text-ink/70 hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Save any selection (props, alt props) to My Bets as a straight bet; tap again to remove. */
export function TrackLegButton({ leg }: { leg: Leg }) {
  const mine = useMyBets();
  const on = mine.has(leg.id);
  return (
    <button type="button" aria-pressed={on} onClick={() => (on ? mine.remove(leg.id) : mine.addLeg(leg))}
      className={cn("mt-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold", on ? "border-neon/60 bg-neon/10 text-neon" : "border-slate-line text-muted-foreground hover:text-ink")}>
      {on ? "✓ Tracked" : "+ Track"}
    </button>
  );
}

/** Published prop results (official stats), fetched once per page. */
export function usePropResults(): PropResultMap {
  const [map, setMap] = useState<PropResultMap>({});
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data/prop-results.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : {})).then(setMap).catch(() => {});
  }, []);
  return map;
}

/** How a bet did, once its game is final: game lines from the final score, props from official stats. */
function resultOf(r: BetRow, props: PropResultMap): Result | undefined {
  const m = r.card.matchup;
  if (m.status !== "final") return undefined;
  if (r.kind === "Prop" || r.kind === "Alt prop") return props[r.key]?.r;
  if (!m.score) return undefined;
  return gradeLeg(r.leg, { [m.id]: { home: m.score.home, away: m.score.away, homeTeam: m.home.name, awayTeam: m.away.name, start: m.startTime } }, []);
}

export function SlipButton({ leg }: { leg: Leg }) {
  const slip = useSlip();
  const [err, setErr] = useState<string | null>(null);
  const on = slip.has(leg.id);
  return (
    <span>
      <button type="button" aria-pressed={on} onClick={() => { if (on) { slip.remove(leg.id); setErr(null); } else setErr(slip.add(leg)); }}
        className={cn("mt-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold", on ? "border-brand bg-brand/15 text-brand" : "border-slate-line text-muted-foreground hover:text-ink")}>
        {on ? "✓ In parlay" : "+ Parlay"}
      </button>
      {err && <span role="alert" className="ml-2 text-[11px] text-warn">{err}</span>}
    </span>
  );
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Main line (over and under at most books), alt milestone (usually over only), or alt under (rare; Kalshi "No"). */
export type PropType = "main" | "alt" | "altUnder";
export function propType(r: Pick<BetRow, "kind" | "leg">): PropType | undefined {
  if (r.kind === "Prop") return "main";
  if (r.kind !== "Alt prop") return undefined;
  return r.leg.side === "under" || r.leg.side === "no" ? "altUnder" : "alt";
}
const TAG: Record<PropType, [string, string]> = {
  main: ["MAIN LINE", "border-info/50 text-info"],
  alt: ["ALT", "border-brand/50 text-brand"],
  altUnder: ["ALT UNDER", "border-warn/60 text-warn"],
};
export function PropTag({ type }: { type?: PropType }) {
  if (!type) return null;
  const [text, cls] = TAG[type];
  return <span className={cn("mr-1.5 inline-block rounded border px-1 py-px align-[1px] text-[9px] font-black tracking-wider", cls)}>{text}</span>;
}
/** Where you can actually bet an alt under. */
export const altUnderTip = (book: string) => book === "Kalshi"
  ? "Most books don't offer alt unders. Bet it on Kalshi (buy No), or use the main line under instead."
  : `Alt unders are rare: ${book} has this one, most other books won't.`;

/** The three prop labels, explained (top of the Props page). */
export function PropKey() {
  return (
    <div className="mb-4 grid gap-1.5 rounded-lg border border-slate-line bg-slate-card p-3 text-xs text-ink/80 sm:grid-cols-3">
      <span><PropTag type="main" />The normal prop: Over and Under at most books.</span>
      <span><PropTag type="alt" />Alt milestone (like 50+ yds): usually Over only.</span>
      <span><PropTag type="altUnder" />Kalshi &quot;No&quot; side; most books don&apos;t have it.</span>
    </div>
  );
}

export function BetList({ rows, showGame = true, empty = "Nothing here yet.", results = {} }: { rows: BetRow[]; showGame?: boolean; empty?: string; results?: PropResultMap }) {
  if (!rows.length) return <p className="rounded-lg border border-dashed border-slate-line bg-slate-card p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="divide-y divide-slate-line overflow-hidden rounded-xl border border-slate-line bg-slate-card">
      {rows.map((r, i) => {
        const diff = r.our !== undefined ? r.our - r.books : 0;
        const res = resultOf(r, results);
        const started = r.card.matchup.status !== "scheduled";
        return (
          <li key={r.key} className="flex items-start gap-3 px-3 py-3 sm:px-4">
            <span className="w-6 shrink-0 pt-0.5 text-right text-xs font-bold tabular-nums text-muted-foreground">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-ink">
                {r.label}
                {res && <span className={cn("ml-2 rounded px-1.5 py-0.5 text-[11px] font-bold", res === "win" ? "bg-neon/15 text-neon" : res === "loss" ? "bg-loss/15 text-loss" : "bg-slate-raised text-ink/70")}>{res === "win" ? "✓ Hit" : res === "loss" ? "✗ Missed" : "Push"}</span>}
                {!res && started && <span className="ml-2 rounded bg-slate-raised px-1.5 py-0.5 text-[11px] font-bold text-ink/70">{r.card.matchup.status === "final" ? "Result pending" : "Live"}</span>}
              </div>
              <div className="text-xs text-muted-foreground"><PropTag type={propType(r)} />{[propType(r) ? "" : r.kind, ...(showGame ? [gameName(r.card), kickoff(r.card.matchup.startTime)] : [])].filter(Boolean).join(" · ")}</div>
              {r.kind === "Prop" && r.our !== undefined && r.our >= PP_MIN && !started && (
                <div className="mt-0.5 text-[11px] font-semibold text-neon" title="Our chance clears the ~58% a PrizePicks pick needs (2-pick Power Play pays 3x).">PP ✓ clears the PrizePicks bar (58%+)</div>
              )}
              {propType(r) === "altUnder" && <div className="mt-0.5 text-[11px] text-warn/90">{altUnderTip(r.book)}</div>}
              {r.why && <div className="mt-0.5 text-xs text-ink/60" title={r.why}>{shortWhy(r.why)}</div>}
              <div className="flex flex-wrap gap-1">
                {!started && (r.bet ? <TrackButton bet={r.bet} card={r.card} /> : <><TrackLegButton leg={r.leg} /><SlipButton leg={r.leg} /></>)}
                {r.whyKey
                  ? <WhyButton parts={propWhyFor(...(r.whyKey.split("|") as [string, string, string]))} target={{ kind: "prop", side: r.leg.side, line: r.leg.line }} />
                  : <WhyButton parts={r.card.why} target={{ kind: "line", market: r.leg.market, side: r.leg.side, line: r.leg.line }} />}
                <HitChartButton card={r.card} bet={{ market: r.leg.market, side: r.leg.side, line: r.leg.line }} whyKey={r.whyKey} />
              </div>
            </div>
            <div className="shrink-0 text-right">
              {/* the books' chance first: it's the more reliable number; ours is a nudge on top */}
              <div className="text-xl font-black tabular-nums text-ink">{pct(r.books)}</div>
              <div className="text-[11px] tabular-nums text-muted-foreground">
                books&apos; chance{r.our !== undefined && <> · ours {pct(r.our)}</>}
                {r.priceEdge !== undefined && <span className="block font-bold text-neon">price +{(r.priceEdge * 100).toFixed(1)} vs market</span>}
                {r.our !== undefined && Math.abs(diff) >= 0.01 && <b className={diff > 0 ? " text-neon" : " text-loss"}> {diff > 0 ? "+" : ""}{Math.round(diff * 100)}</b>}
              </div>
              <div className="mt-0.5 text-sm font-bold tabular-nums">{fmtAmerican(r.odds)} <span className="text-[11px] font-normal text-muted-foreground">{r.book}</span></div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

