import type { ReactNode } from "react";
import type { MatchupCardData, ValueBet } from "@/types/sports";
import { Badge } from "@/components/ui/badge";
import { kalshiPhrase } from "@/lib/kalshi-terms";
import { fmtAmerican, fmtKickoff } from "@/lib/utils";
import { LineMove } from "./line-move";
import { TrackButton } from "./track-button";

/**
 * Phone layout for one pick: the price and the key numbers sit up top where a table would push them off-screen.
 * `stats` are the 2-3 numbers that matter on the page using it (hit chance, edge, payout...).
 */
export function PickCard({ bet, card, stats, note }: { bet: ValueBet; card?: MatchupCardData; stats: { label: string; value: ReactNode }[]; note?: ReactNode }) {
  const m = card?.matchup;
  const k = m ? kalshiPhrase(bet.market, bet.side, bet.line, m.home.shortName, m.away.shortName) : null;
  return (
    <li className="rounded-lg border border-slate-line bg-slate-raised/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{bet.label}</div>
          {m && <div className="mt-0.5 text-xs text-muted-foreground"><Badge variant="outline" className="mr-1.5">{m.league}</Badge>{m.away.shortName} @ {m.home.shortName} · {fmtKickoff(m.startTime)}</div>}
          {k && <div className="mt-0.5 text-[11px] font-medium text-info">(Kalshi: {k})</div>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-bold tabular-nums">{fmtAmerican(bet.bestQuote.americanOdds)}</div>
          <div className="text-[11px] text-muted-foreground">{bet.bestQuote.bookmaker.name}</div>
        </div>
      </div>
      <dl className="mt-2 grid gap-2 text-center" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border border-slate-line px-1 py-1.5">
            <dt className="text-[10px] text-muted-foreground">{s.label}</dt>
            <dd className="text-sm font-bold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <TrackButton bet={bet} card={card} />
        <div className="text-right"><LineMove bet={bet} />{note}</div>
      </div>
    </li>
  );
}
