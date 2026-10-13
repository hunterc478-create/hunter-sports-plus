"use client";
/**
 * "Why?" button: every factor behind a pick, each marked as helping (▲) or hurting (▼) the side you're looking at.
 * Game lines read the game's factors; props and TD picks read the player's projection breakdown.
 */
import { useState } from "react";
import type { MatchupCardData, WhyPart } from "@/types/sports";
import { cn } from "@/lib/utils";

/** Player projection reasons for the whole bundle, by "<matchupId>|<player>|<stat>" (set once per page by the views). */
let PROP_WHY: Record<string, WhyPart[]> = {};
export const setPropWhy = (m?: Record<string, WhyPart[]>) => { if (m) PROP_WHY = m; };
export const propWhyFor = (matchupId: string, player: string, stat: string) => PROP_WHY[`${matchupId}|${player}|${stat}`];

/** What the pick is, so each reason can be pointed at it. */
export type WhyTarget =
  | { kind: "line"; market: string; side: string; line?: number }
  | { kind: "prop"; side: string; line?: number };

function dirOf(p: WhyPart, t: WhyTarget): 1 | -1 | 0 {
  const sgn = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0) as 1 | -1 | 0;
  if (t.kind === "prop") {
    const over = t.side === "over" || t.side === "yes" ? 1 : -1;
    if (p.v !== undefined) return t.line === undefined ? 0 : (sgn(p.v - t.line) * over) as 1 | -1 | 0;
    if (p.f === undefined || Math.abs(p.f - 1) < 0.02) return 0;
    return (sgn(p.f - 1) * over) as 1 | -1 | 0;
  }
  const market = t.market.replace("alt_", "");
  if (p.v !== undefined) {   // our projected score vs this bet
    if (market === "total") return t.line === undefined || p.t === undefined ? 0 : (sgn(p.t - t.line) * (t.side === "over" ? 1 : -1)) as 1 | -1 | 0;
    const m = p.m ?? 0;
    if (market === "spread") return sgn((t.side === "home" ? m : -m) + (t.line ?? 0));
    return sgn(t.side === "home" ? m : -m);
  }
  if (market === "total") { const x = p.t ?? 0; return Math.abs(x) < 0.05 ? 0 : (sgn(x) * (t.side === "over" ? 1 : -1)) as 1 | -1 | 0; }
  const x = p.m ?? 0;
  return Math.abs(x) < 0.05 ? 0 : (sgn(x) * (t.side === "home" ? 1 : t.side === "away" ? -1 : 0)) as 1 | -1 | 0;
}

export function WhyButton({ parts, target }: { parts?: WhyPart[]; target: WhyTarget }) {
  const [open, setOpen] = useState(false);
  if (!parts?.length) return null;
  const rows = parts.map((p) => ({ p, d: dirOf(p, target) }));
  const up = rows.filter((r) => r.d > 0 && !r.p.ctx).length, down = rows.filter((r) => r.d < 0 && !r.p.ctx).length;
  return (
    <div className="w-full">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className={cn("mt-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold", open ? "border-brand bg-brand/15 text-brand" : "border-slate-line text-muted-foreground hover:text-ink")}>
        {open ? "Hide why" : `Why? ${up ? `▲${up}` : ""}${up && down ? " " : ""}${down ? `▼${down}` : ""}`}
      </button>
      {open && (
        <ul className="mt-2 space-y-1 rounded-lg border border-slate-line bg-obsidian/60 p-2.5 text-xs">
          {rows.map(({ p, d }, i) => (
            <li key={i} className="flex gap-2">
              <span className={cn("w-3 shrink-0 text-center font-black", d > 0 ? "text-neon" : d < 0 ? "text-loss" : "text-muted-foreground")}>{d > 0 ? "▲" : d < 0 ? "▼" : "•"}</span>
              <span className="min-w-0"><b className="text-ink">{p.k}:</b> <span className="text-ink/80">{p.text}</span>{p.ctx && <span className="text-muted-foreground"> (context)</span>}</span>
            </li>
          ))}
          <li className="pt-1 text-[10px] text-muted-foreground">▲ helps this bet · ▼ hurts it · • checked, no real effect. &quot;Context&quot; is shown for you but isn&apos;t part of our number.</li>
        </ul>
      )}
    </div>
  );
}

/** The whole game's factors, with the team each one favors (game page). */
export function MatchupBreakdown({ card }: { card: MatchupCardData }) {
  const parts = card.why ?? [];
  if (!parts.length) return null;
  const H = card.matchup.home.shortName, A = card.matchup.away.shortName;
  return (
    <ul className="space-y-1.5 rounded-xl border border-slate-line bg-slate-card p-4 text-sm">
      {parts.map((p, i) => {
        const m = p.v ? 0 : p.m ?? 0;
        const who = Math.abs(m) < 0.05 ? "" : m > 0 ? H : A;
        const tot = p.v ? 0 : p.t ?? 0;
        return (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2">
            <b className="text-ink">{p.k}:</b><span className="text-ink/80">{p.text}</span>
            {who && <span className="rounded bg-brand/15 px-1.5 text-[11px] font-bold text-brand">helps {who}</span>}
            {Math.abs(tot) >= 0.3 && <span className="rounded bg-slate-raised px-1.5 text-[11px] font-bold text-ink/70">{tot > 0 ? "more points" : "fewer points"}</span>}
            {p.ctx && <span className="text-[11px] text-muted-foreground">(context)</span>}
          </li>
        );
      })}
    </ul>
  );
}
