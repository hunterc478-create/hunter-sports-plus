"use client";
/**
 * Hit-rate chart (like PropFinder): tap a bet and see, game by game, whether it would have cleared this line.
 * Props: the player's stat each game. Spreads: the team's margin (did it cover this number?). Moneylines: margin
 * (won?). Totals: both teams' game totals. Tabs: last 5, last 10 (default), this season, last season, vs this opponent.
 */
import { useState } from "react";
import type { MatchupCardData } from "@/types/sports";
import { cn } from "@/lib/utils";

type TeamGame = { d: string; o: string; h: 0 | 1; f: number; a: number; ls?: 1 };
type PlayerGame = { w: number; o: string; v: number; t?: string; ls?: 1 };
let TEAM: Record<string, TeamGame[]> = {};
let PLAYER: Record<string, PlayerGame[]> = {};
/** Set once per page by the views (the logs ride along in the data bundle). */
export const setLogs = (b: { teamLogs?: Record<string, TeamGame[]>; playerLogs?: Record<string, PlayerGame[]> }) => {
  if (b.teamLogs) TEAM = b.teamLogs;
  if (b.playerLogs) PLAYER = b.playerLogs;
};

/** One bar: its value, the opponent, and whether it's from last season. */
type Pt = { v: number; o: string; ls?: boolean };
type Series = { title: string; pts: Pt[]; t: number; dir: 1 | -1; unit: string; opp?: string; label?: string };
// nflverse writes the Rams and Commanders differently from ESPN
const ab = (x: string) => (x === "LA" ? "LAR" : x === "WAS" ? "WSH" : x).toUpperCase();

/** What to chart for a bet. market/side/line come from the bet; whyKey ("<game>|<player>|<stat>") marks props. */
export function seriesFor(card: MatchupCardData, bet: { market: string; side: string; line?: number }, whyKey?: string): Series[] {
  const m = card.matchup;
  if (whyKey) {
    const [, player, stat] = whyKey.split("|");
    const log = PLAYER[`${player}|${stat}`];
    if (!log?.length) return [];
    const over = bet.side === "over" || bet.side === "yes";
    // tonight's opponent: whichever team in this game he doesn't play for (his team from his latest game)
    const mine = ab(log[0].t ?? "");
    const opp = [m.home.abbreviation, m.away.abbreviation].map((a) => ab(a ?? "")).find((a) => a && a !== mine);
    return [{ title: player, pts: log.map((g) => ({ v: g.v, o: ab(g.o), ls: !!g.ls })), t: bet.line ?? 0.5, dir: over ? 1 : -1, unit: stat.replace(/_/g, " "), opp }];
  }
  const market = bet.market.replace("alt_", "");
  const log = (t: typeof m.home) => TEAM[`${m.league}:${t.id}`] ?? [];
  if (market === "total") {
    return ([m.away, m.home] as const).map((t) => ({ title: `${t.shortName} games`, pts: log(t).map((g) => ({ v: g.f + g.a, o: g.o, ls: !!g.ls })), t: bet.line ?? 0, dir: bet.side === "over" ? 1 : -1, unit: "total points",
      opp: (t === m.home ? m.away : m.home).abbreviation } as Series)).filter((s) => s.pts.length);
  }
  if (bet.side !== "home" && bet.side !== "away") return [];
  const team = m[bet.side], other = bet.side === "home" ? m.away : m.home;
  const pts = log(team).map((g) => ({ v: g.f - g.a, o: g.o, ls: !!g.ls }));
  if (!pts.length) return [];
  // spread: covered when margin + line > 0, so the bar has to clear -line; moneyline: won (margin above 0)
  return [{ title: team.shortName, pts, t: market === "spread" ? -(bet.line ?? 0) : 0, dir: 1, unit: "margin", opp: other.abbreviation,
    label: market === "spread" ? `covers ${(bet.line ?? 0) > 0 ? "+" : ""}${bet.line ?? 0}` : "won the game" }];
}

const RANGES = [["l5", "L5"], ["l10", "L10"], ["season", "Season"], ["last", "Last season"], ["opp", "vs opp"]] as const;
type Range = (typeof RANGES)[number][0];
const pick = (s: Series, r: Range) =>
  r === "l5" ? s.pts.slice(0, 5) : r === "l10" ? s.pts.slice(0, 10) : r === "season" ? s.pts.filter((p) => !p.ls) : r === "last" ? s.pts.filter((p) => p.ls) : s.pts.filter((p) => s.opp && p.o === s.opp);
const hit = (s: Series, p: Pt) => (p.v === s.t ? 0 : (p.v - s.t) * s.dir > 0 ? 1 : -1);

function Chart({ s, range }: { s: Series; range: Range }) {
  const pts = pick(s, range).slice().reverse();   // oldest on the left
  if (!pts.length) return <p className="py-3 text-xs text-muted-foreground">{range === "opp" ? "No games against this opponent in the log." : "No games in this range."}</p>;
  const vals = pts.map((p) => p.v);
  const hi = Math.max(0, s.t, ...vals), lo = Math.min(0, s.t, ...vals);
  const span = hi - lo || 1;
  const y = (v: number) => ((hi - v) / span) * 100;   // % from the top
  const wins = pts.filter((p) => hit(s, p) > 0).length, pushes = pts.filter((p) => hit(s, p) === 0).length;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <b className="text-ink">{s.title}</b>
        <span><b className={wins / pts.length >= 0.6 ? "text-neon" : wins / pts.length < 0.45 ? "text-loss" : "text-ink"}>Hit {wins} of {pts.length}</b>{pushes ? <span className="text-muted-foreground"> · {pushes} push</span> : null}<span className="text-muted-foreground"> · {s.label ?? `${s.dir > 0 ? "over" : "under"} ${Number.isInteger(s.t) ? s.t : s.t.toFixed(1)} ${s.unit}`}</span></span>
      </div>
      <div className="relative h-32 rounded-md border border-slate-line bg-obsidian/60">
        <div aria-hidden className="absolute inset-x-0 border-t-2 border-dashed border-ink/60" style={{ top: `${y(s.t)}%` }} />
        {lo < 0 && <div aria-hidden className="absolute inset-x-0 border-t border-slate-line" style={{ top: `${y(0)}%` }} />}
        <div className="absolute inset-0 flex items-stretch gap-1 px-1">
          {pts.map((p, i) => {
            const h = hit(s, p);
            const top = Math.min(y(p.v), y(0)), height = Math.max(2, Math.abs(y(p.v) - y(0)));
            return (
              <div key={i} className="relative flex-1" title={`${p.o}: ${p.v}`}>
                <div className={cn("absolute inset-x-0 rounded-sm", h > 0 ? "bg-neon" : h < 0 ? "bg-loss" : "bg-muted-foreground", p.ls && "opacity-45")} style={{ top: `${top}%`, height: `${height}%` }} />
                <span className="absolute inset-x-0 text-center text-[9px] font-bold tabular-nums text-ink" style={{ top: `calc(${Math.max(0, top - 9)}%)` }}>{Number.isInteger(p.v) ? p.v : p.v.toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-0.5 flex gap-1 px-1">{pts.map((p, i) => <span key={i} className={cn("flex-1 truncate text-center text-[9px] text-muted-foreground", p.ls && "opacity-60")}>{p.o}</span>)}</div>
    </div>
  );
}

export function HitChartButton({ card, bet, whyKey }: { card: MatchupCardData; bet: { market: string; side: string; line?: number }; whyKey?: string }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<Range>("l10");
  const series = seriesFor(card, bet, whyKey);
  if (!series.length) return null;
  return (
    <div className="w-full">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className={cn("mt-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold", open ? "border-brand bg-brand/15 text-brand" : "border-slate-line text-muted-foreground hover:text-ink")}>
        {open ? "Hide chart" : `📊 Hit rate · L10 ${series.map((s) => { const p = pick(s, "l10"); return `${p.filter((x) => hit(s, x) > 0).length}/${p.length}`; }).join(" · ")}`}
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-slate-line bg-slate-card p-2.5">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Range">
            {RANGES.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)}
                className={cn("rounded-md border px-2 py-0.5 text-[11px] font-bold", range === k ? "border-brand bg-brand/15 text-brand" : "border-slate-line text-muted-foreground")}>{label}</button>
            ))}
          </div>
          {series.map((s) => <Chart key={s.title} s={s} range={range} />)}
          <p className="text-[10px] text-muted-foreground">Green cleared the line, red missed; faded bars are last season. Hit rates are research, not a pick: books know them too, so read them next to our chance and Why?.</p>
        </div>
      )}
    </div>
  );
}
