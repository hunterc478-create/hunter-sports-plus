"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { MatchupCardData, ValueBet } from "@/types/sports";
import { isMainLine } from "@/lib/live/openers";
import { probToAmerican } from "@/lib/odds-math";
import { cn, fmtAmerican, fmtKickoff, fmtPct } from "@/lib/utils";
import { OddsButton } from "./odds-button";

const fmtLine = (x?: number) => (x === undefined ? "" : x > 0 ? `+${x}` : `${x}`);

/** The main-line bet for one side of one market (falls back to the line most books price). */
function mainBet(c: MatchupCardData, market: "spread" | "total" | "moneyline", side: string): ValueBet | undefined {
  const all = [c.recommended, ...c.otherBets].filter((b) => b.market === market && b.side === side);
  return all.find((b) => isMainLine(c, b)) ?? [...all].sort((a, b) => (b.marketBooks ?? 0) - (a.marketBooks ?? 0))[0];
}

/** One game on the odds board: teams, then spread / total / moneyline chips; expands to every book's price. */
export function GameRow({ card, defaultOpen = false }: { card: MatchupCardData; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const m = card.matchup;
  const draw = card.recommended.market === "moneyline" && card.recommended.side === "draw" ? card.recommended : card.otherBets.find((b) => b.market === "moneyline" && b.side === "draw");
  const rows = [
    { team: m.away, spread: mainBet(card, "spread", "away"), total: mainBet(card, "total", "over"), ml: mainBet(card, "moneyline", "away"), totalTop: "O" },
    { team: m.home, spread: mainBet(card, "spread", "home"), total: mainBet(card, "total", "under"), ml: mainBet(card, "moneyline", "home"), totalTop: "U" },
  ];
  const lean = card.prediction.modelVersion !== "market" ? card.prediction : null;
  return (
    <div className="rounded-lg border border-slate-line bg-slate-card">
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,60px)] items-center gap-x-1.5 gap-y-1.5 p-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,76px)] sm:gap-x-3">
        <div className="col-span-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground/80">{m.league}</span>
          <span>{m.status === "live" ? <span className="font-semibold text-loss">LIVE</span> : fmtKickoff(m.startTime)}</span>
        </div>
        {["Spread", "Total", "Money"].map((h) => <div key={h} className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</div>)}
        {rows.map((r) => (
          <div key={r.team.id} className="contents">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold sm:text-base">{r.team.shortName}</div>
              {r.team.record && <div className="text-[11px] text-muted-foreground">{r.team.record}</div>}
            </div>
            <OddsButton bet={r.spread} card={card} top={fmtLine(r.spread?.line)} />
            <OddsButton bet={r.total} card={card} top={r.total?.line !== undefined ? `${r.totalTop} ${r.total.line}` : undefined} />
            <OddsButton bet={r.ml} card={card} />
          </div>
        ))}
        {draw && (
          <div className="contents">
            <div className="text-sm text-muted-foreground">Draw</div>
            <div /><div />
            <OddsButton bet={draw} card={card} />
          </div>
        )}
      </div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-t border-slate-line px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground">
        <span className="min-w-0 truncate">{lean ? `Our stats model: ${m.home.shortName} ${fmtPct(lean.homeWinProb, 0)} · total ${lean.projectedTotal.toFixed(1)}` : "Market consensus only (no team stats for this league)"}</span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">All books <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} /></span>
      </button>
      {open && <BookTable card={card} bets={[...rows.flatMap((r) => [r.spread, r.total, r.ml]), draw].filter((b): b is ValueBet => !!b)} />}
    </div>
  );
}

/** Best-price finder: every book's price for each main-line bet, the consensus fair price, best highlighted. */
function BookTable({ card, bets }: { card: MatchupCardData; bets: ValueBet[] }) {
  const books = [...new Set(bets.flatMap((b) => (b.books ?? []).map((q) => q.name)))].sort();
  if (!books.length) return <p className="px-3 pb-3 text-xs text-muted-foreground">No per-book prices for this game.</p>;
  return (
    <div className="overflow-x-auto border-t border-slate-line px-3 pb-3 pt-2">
      <table className="w-full min-w-[560px] text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-medium">Bet</th>
            <th className="py-1 pr-2 text-right font-medium">Fair</th>
            {books.map((n) => <th key={n} className="py-1 pr-2 text-right font-medium">{n}</th>)}
          </tr>
        </thead>
        <tbody>
          {bets.map((b) => {
            const best = b.books?.[0]?.odds;
            return (
              <tr key={b.id} className="border-t border-slate-line">
                <td className="py-1.5 pr-2 font-medium">{b.label}</td>
                <td className="py-1.5 pr-2 text-right text-muted-foreground" title="No-vig consensus of the sportsbooks">{b.marketProb ? fmtAmerican(probToAmerican(b.marketProb)) : "—"}</td>
                {books.map((n) => {
                  const q = b.books?.find((x) => x.name === n);
                  return <td key={n} className={cn("py-1.5 pr-2 text-right", q && q.odds === best ? "font-bold text-neon" : "")}>{q ? fmtAmerican(q.odds) : <span className="text-muted-foreground/50">—</span>}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">Green is the best price. &quot;Fair&quot; is what the price would be with the books&apos; cut removed, using the {card.recommended.marketBooks ?? "several"}-book consensus.</p>
    </div>
  );
}
