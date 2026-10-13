"use client";
import { useState } from "react";
import type { MatchupCardData, ValueBet } from "@/types/sports";
import { legFromBet, useSlip } from "@/lib/my-bets";
import { isValueBet } from "@/lib/live/policy";
import { cn, fmtAmerican } from "@/lib/utils";

/**
 * Sportsbook-style odds chip: the line on top, the best price below, the book underneath. Tapping adds it to the parlay
 * slip (and again removes it). A value price (beats the consensus by the league's minimum edge) gets a green +EV tag.
 */
export function OddsButton({ bet, card, top }: { bet?: ValueBet; card: MatchupCardData; top?: string }) {
  const slip = useSlip();
  const [err, setErr] = useState<string | null>(null);
  if (!bet) return <div className="flex h-14 items-center justify-center rounded-md border border-dashed border-slate-line text-xs text-muted-foreground">—</div>;
  const on = slip.has(bet.id);
  const value = isValueBet(bet, card.matchup.league);
  const ev = bet.expectedValue * 100;
  return (
    <button type="button" aria-pressed={on} title={err ?? `${bet.label} at ${bet.bestQuote.bookmaker.name}${bet.marketProb ? ` · fair ${Math.round(bet.marketProb * 100)}%` : ""}`}
      onClick={() => { if (on) { slip.remove(bet.id); setErr(null); } else setErr(slip.add(legFromBet(bet, card))); }}
      className={cn("relative flex h-14 w-full flex-col items-center justify-center rounded-md border px-1 text-center transition-colors",
        on ? "border-neon bg-neon/15" : value ? "border-neon/50 bg-slate-raised hover:bg-slate-hover" : "border-slate-line bg-slate-raised hover:bg-slate-hover",
        err && "border-warn")}>
      {top && <span className="text-[11px] leading-tight text-muted-foreground">{top}</span>}
      <span className={cn("text-[13px] font-bold leading-tight tabular-nums sm:text-sm", on ? "text-neon" : "")}>{fmtAmerican(bet.bestQuote.americanOdds)}</span>
      <span className="max-w-full truncate text-[9px] leading-tight text-muted-foreground">{bet.bestQuote.bookmaker.name}</span>
      {value && <span className="absolute -right-1 -top-2 rounded bg-neon px-1 text-[9px] font-bold leading-4 text-obsidian">+{ev.toFixed(1)}%</span>}
    </button>
  );
}
