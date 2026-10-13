import Link from "next/link";
import type { Competitor, MatchupCardData, ValueBet } from "@/types/sports";
import { isMainLine } from "@/lib/live/openers";
import { isValueBet } from "@/lib/live/policy";
import { kickoff, teamLogo } from "@/lib/nfl";
import { sportColor } from "./league";
import { fmtAmerican } from "@/lib/utils";
import { alpha, colorOf } from "@/lib/team-colors";

/** Teaser-leg bar a 2-team, 6-point teaser at -120 has to clear, per leg. */
export const TEASER_BREAKEVEN = 0.739;
/** A leg worth flagging: clears at least the 3-team (+160) bar of 72.7%. */
export const TEASER_LEG_MIN = 0.727;

export function mainBet(c: MatchupCardData, market: "spread" | "total" | "moneyline", side: string): ValueBet | undefined {
  const all = [c.recommended, ...c.otherBets].filter((b) => b.market === market && b.side === side);
  return all.find((b) => isMainLine(c, b)) ?? [...all].sort((a, b) => (b.marketBooks ?? 0) - (a.marketBooks ?? 0))[0];
}

export function TeamLogo({ team, size = 28, league }: { team: Competitor; size?: number; league?: string }) {
  const src = teamLogo(team, league);
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" width={size} height={size} className="shrink-0 object-contain" loading="lazy" />
    : <span className="grid shrink-0 place-items-center rounded-full bg-slate-raised text-[10px] font-bold" style={{ width: size, height: size }}>{team.abbreviation ?? team.shortName.slice(0, 3)}</span>;
}

const line = (x?: number) => (x === undefined ? "" : x > 0 ? `+${x}` : `${x}`);

/** One game on the week view; the whole tile opens the game page. */
export function GameTile({ card }: { card: MatchupCardData }) {
  const m = card.matchup;
  const values = [card.recommended, ...card.otherBets].filter((b) => isValueBet(b, m.league)).length;
  const teaser = (card.teasers ?? []).filter((t) => t.prob >= TEASER_LEG_MIN).length;
  const over = mainBet(card, "total", "over");
  const rows = (["away", "home"] as const).map((side) => ({ side, team: m[side], spread: mainBet(card, "spread", side), ml: mainBet(card, "moneyline", side) }));
  return (
    <Link href={`/game/${m.id}/`} className="group relative block overflow-hidden rounded-xl border border-slate-line p-4 transition-colors hover:border-ink/30"
      style={{ background: `linear-gradient(135deg, ${alpha(colorOf(m.away, m.league), 0.16)} 0%, #17191E 45%, #17191E 55%, ${alpha(colorOf(m.home, m.league), 0.16)} 100%)` }}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${colorOf(m.away, m.league)} 0 50%, ${colorOf(m.home, m.league)} 50% 100%)` }} />
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span><b className="mr-1.5" style={{ color: sportColor(m.league) }}>{m.league}</b>{m.status === "live" ? <b className="text-loss">LIVE</b> : m.status === "final" ? <b className="text-ink">FINAL</b> : kickoff(m.startTime)}</span>
        <span className="flex gap-1">
          {values > 0 && <span className="rounded bg-neon/10 px-1.5 py-0.5 font-bold text-neon">{values} value</span>}
          {teaser > 0 && <span className="rounded bg-brand-soft px-1.5 py-0.5 font-bold text-brand">teaser leg</span>}
        </span>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.side} className="flex items-center gap-3">
            <TeamLogo team={r.team} league={m.league} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold text-ink">{r.team.shortName}{m.score && m.status !== "scheduled" && <span className="ml-2 tabular-nums">{m.score[r.side]}</span>}</div>
              {r.team.record && <div className="text-[11px] text-muted-foreground">{r.team.record}</div>}
            </div>
            <div className="w-16 text-right text-sm tabular-nums">
              <div className="font-semibold">{line(r.spread?.line)}</div>
              <div className="text-[11px] text-muted-foreground">{r.spread ? fmtAmerican(r.spread.bestQuote.americanOdds) : ""}</div>
            </div>
            <div className="w-14 text-right text-sm font-semibold tabular-nums">{r.ml ? fmtAmerican(r.ml.bestQuote.americanOdds) : "—"}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-line pt-2.5 text-xs text-muted-foreground">
        <span>Total {over?.line ?? "—"}{m.venue?.indoor ? " · indoors" : card.factors.weather ? ` · ${Math.round(card.factors.weather.temperatureF)}°F, wind ${Math.round(card.factors.weather.windMph)}` : ""}</span>
        <span className="font-semibold text-brand group-hover:underline">Game page →</span>
      </div>
    </Link>
  );
}
