import type { MatchupCardData, ValueBet } from "@/types/sports";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { probToAmerican } from "@/lib/odds-math";
import { cn, fmtAmerican, fmtKickoff, fmtPct } from "@/lib/utils";
import { LineMove } from "./line-move";
import { TrackButton } from "./track-button";
import { PickCard } from "./pick-card";
import { kalshiPhrase } from "@/lib/kalshi-terms";

const evText = (b: ValueBet) => `${b.expectedValue >= 0 ? "+" : ""}${(b.expectedValue * 100).toFixed(1)}%`;
const fair = (b: ValueBet) => (b.marketProb ? fmtAmerican(probToAmerican(b.marketProb)) : "—");

/** Does our stats model agree? Shown for context only; picks come from the market. */
function Lean({ b }: { b: ValueBet }) {
  if (b.modelOnlyProb === undefined || b.marketProb === undefined) return <span className="text-muted-foreground">—</span>;
  const d = b.modelOnlyProb - b.marketProb;
  return <span className={cn("text-xs", Math.abs(d) < 0.02 ? "text-muted-foreground" : d > 0 ? "text-neon" : "text-warn")}>{Math.abs(d) < 0.02 ? "Agrees" : d > 0 ? "Likes it" : "Against"}</span>;
}

export function EvPicksTable({ picks, matchups, limit, title = "Value bets", description }: { picks: ValueBet[]; matchups: MatchupCardData[]; limit?: number; title?: string; description?: string }) {
  const byId = new Map(matchups.map((m) => [m.matchup.id, m.matchup]));
  const cards = new Map(matchups.map((m) => [m.matchup.id, m]));
  const rows = limit ? picks.slice(0, limit) : picks;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description ?? "Bets where one sportsbook pays more than the fair price from the consensus of all the books. EV is the average return per bet at that price."}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* phones: cards, so price and EV aren't pushed off-screen */}
        <ul className="space-y-2 md:hidden">
          {rows.map((b) => (
            <PickCard key={b.id} bet={b} card={cards.get(b.matchupId)}
              stats={[{ label: "EV", value: <span className="text-neon">{evText(b)}</span> }, { label: "Fair price", value: fair(b) }, { label: "Books", value: b.marketBooks ?? "—" }]}
              note={<div className="text-[11px] text-muted-foreground">Our model: <Lean b={b} /></div>} />
          ))}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Bet</th>
                <th className="pb-2 font-medium">Game</th>
                <th className="pb-2 text-right font-medium">Best price</th>
                <th className="pb-2 text-right font-medium" title="Price with the books' cut removed, from the consensus">Fair</th>
                <th className="pb-2 text-right font-medium" title="Average return per bet at the best price">EV</th>
                <th className="pb-2 text-right font-medium" title="Books behind the fair price">Books</th>
                <th className="pb-2 pl-4 font-medium" title="Our team-stats model, for context only">Model</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const m = byId.get(b.matchupId);
                const k = m ? kalshiPhrase(b.market, b.side, b.line, m.home.shortName, m.away.shortName) : null;
                return (
                  <tr key={b.id} className="border-t border-slate-line align-top">
                    <td className="py-3 pr-3">
                      <div className="font-semibold">{b.label}</div>
                      {k && <div className="text-[11px] font-medium text-info">(Kalshi: {k})</div>}
                      <div className="text-xs capitalize text-muted-foreground">{b.market.replace("_", " ")}</div>
                      <TrackButton bet={b} card={cards.get(b.matchupId)} />
                    </td>
                    <td className="py-3 pr-3">
                      {m && <><Badge variant="outline" className="mr-2">{m.league}</Badge><span className="text-muted-foreground">{m.away.shortName} @ {m.home.shortName}</span>
                      <div className="text-xs text-muted-foreground">{fmtKickoff(m.startTime)}</div></>}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      <div className="font-bold">{fmtAmerican(b.bestQuote.americanOdds)}</div>
                      <div className="text-xs text-muted-foreground">{b.bestQuote.bookmaker.name}</div>
                      <LineMove bet={b} />
                    </td>
                    <td className="py-3 text-right tabular-nums text-muted-foreground">{fair(b)}<div className="text-[11px]">{b.marketProb ? fmtPct(b.marketProb, 0) : ""}</div></td>
                    <td className="py-3 text-right font-bold tabular-nums text-neon">{evText(b)}</td>
                    <td className="py-3 text-right tabular-nums text-muted-foreground">{b.marketBooks ?? "—"}</td>
                    <td className="py-3 pl-4"><Lean b={b} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Prices refresh about every 30 minutes, so check the book before betting: an outlier price can be gone quickly. Even real +EV bets lose often; the edge only shows over many bets.</p>
      </CardContent>
    </Card>
  );
}
