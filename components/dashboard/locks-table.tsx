import type { MatchupCardData, TrackRecordSummary, ValueBet } from "@/types/sports";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtAmerican, fmtKickoff, fmtPct, fmtUnits } from "@/lib/utils";
import { kalshiPhrase } from "@/lib/kalshi-terms";
import { toDecimal } from "@/lib/odds-math";
import { LineMove } from "./line-move";
import { TrackButton } from "./track-button";
import { PickCard } from "./pick-card";

/** What $100 wins at these odds. */
const payout = (american: number) => Math.round((toDecimal(american) - 1) * 100);

export function LocksRecord({ summary }: { summary?: TrackRecordSummary }) {
  const decided = summary ? summary.wins + summary.losses : 0;
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Locks record" value={summary ? `${summary.wins}-${summary.losses}${summary.pushes ? `-${summary.pushes}` : ""}` : "0-0"} />
      <Stat label="Hit rate" value={decided ? fmtPct(summary!.wins / decided, 0) : "—"} />
      <Stat label="Units" value={summary ? fmtUnits(summary.unitsProfit) : "+0.00u"} tone={summary && summary.unitsProfit < 0 ? "text-loss" : "text-neon"} />
      <Stat label="ROI" value={summary && summary.picks ? fmtPct(summary.roi) : "—"} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-line bg-slate-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function LocksTable({ locks, matchups }: { locks: ValueBet[]; matchups: MatchupCardData[] }) {
  const byId = new Map(matchups.map((m) => [m.matchup.id, m.matchup]));
  const cards = new Map(matchups.map((m) => [m.matchup.id, m]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Locks</CardTitle>
        <CardDescription>
          The likeliest straight bets on the board: the model gives each at least a 62% chance, the price is within 1.5 points of fair, and nothing is shorter than -400. One per game.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 md:hidden">
          {locks.map((b) => (
            <PickCard key={b.id} bet={b} card={cards.get(b.matchupId)}
              stats={[
                { label: "Hit chance", value: <span className="text-neon">{fmtPct(b.modelProb, 0)}</span> },
                { label: "$100 wins", value: `$${payout(b.bestQuote.americanOdds)}` },
                { label: "Deal", value: b.edge >= 0 ? <span className="text-neon">Value</span> : <span className="text-muted-foreground">Near fair</span> },
              ]}
              note={<div className="text-[11px] text-muted-foreground">Loses about 1 in {Math.max(1, Math.round(1 / (1 - b.modelProb)))}</div>} />
          ))}
        </ul>
        <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Pick</th>
              <th className="pb-2 font-medium">Game</th>
              <th className="pb-2 text-right font-medium">Price</th>
              <th className="pb-2 text-right font-medium">Hit chance</th>
              <th className="pb-2 text-right font-medium">Book implied</th>
              <th className="pb-2 text-right font-medium">$100 wins</th>
              <th className="pb-2 pl-4 font-medium">Deal</th>
              <th className="pb-2 pl-4 font-medium">Loses about</th>
            </tr>
          </thead>
          <tbody>
            {locks.map((b) => {
              const m = byId.get(b.matchupId);
              const k = m ? kalshiPhrase(b.market, b.side, b.line, m.home.shortName, m.away.shortName) : null;
              const lose = Math.max(1, Math.round(1 / (1 - b.modelProb)));
              return (
                <tr key={b.id} className="border-t border-slate-line">
                  <td className="py-3 pr-3">
                    <div className="font-semibold">{b.label}</div>
                    {k && <div className="text-[11px] font-medium text-info">(Kalshi: {k})</div>}
                    <div className="text-xs capitalize text-muted-foreground">{b.market}</div>
                    <TrackButton bet={b} card={cards.get(b.matchupId)} />
                  </td>
                  <td className="py-3 pr-3">
                    {m && <><Badge variant="outline" className="mr-2">{m.league}</Badge><span className="text-muted-foreground">{m.away.shortName} @ {m.home.shortName}</span>
                    <div className="text-xs text-muted-foreground">{fmtKickoff(m.startTime)}</div></>}
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    <div className="font-semibold">{fmtAmerican(b.bestQuote.americanOdds)}</div>
                    <div className="text-xs text-muted-foreground">{b.bestQuote.bookmaker.name}</div>
                    <LineMove bet={b} />
                  </td>
                  <td className="py-3 text-right text-base font-bold tabular-nums text-neon">{fmtPct(b.modelProb, 0)}</td>
                  <td className="py-3 text-right tabular-nums text-muted-foreground">{fmtPct(b.impliedProb, 0)}</td>
                  <td className="py-3 text-right tabular-nums">${payout(b.bestQuote.americanOdds)}</td>
                  <td className="py-3 pl-4 text-xs">{b.edge >= 0
                    ? <span className="font-semibold text-neon">Value</span>
                    : <span className="text-muted-foreground" title="Slightly under the fair price, but less than a normal sportsbook cut">Near fair</span>}</td>
                  <td className="py-3 pl-4 text-xs text-muted-foreground">1 in {lose}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          &quot;Lock&quot; is a nickname, not a promise: at 70%, three in every ten still lose, and these short prices mean one loss can wipe out two or three wins. The record above tracks how they really do.
        </p>
      </CardContent>
    </Card>
  );
}
