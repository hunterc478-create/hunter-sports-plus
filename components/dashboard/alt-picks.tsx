import { Star } from "lucide-react";
import type { AltPick } from "@/types/sports";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtAmerican, fmtPct } from "@/lib/utils";
import { EdgePill } from "./edge-pill";

export function AltPicks({ picks, limit, compact }: { picks: AltPick[]; limit?: number; compact?: boolean }) {
  const list = limit ? picks.slice(0, limit) : picks;
  return (
    <Card className="border-neon/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Star className="h-4 w-4 fill-neon text-neon" /> Recommended alt picks</CardTitle>
        <CardDescription>
          Alt lines and alt props that pay between -250 and +200, where our chance beats the price by 3+ points. Alt lines start
          from the sportsbooks&apos; line and the model moves them 30%; player numbers come from our own projections (recent form,
          opponent, game script). At most one alt line per game.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!list.length ? (
          <p className="text-sm text-muted-foreground">Nothing clears the bar for this day yet. Alt lines and Kalshi props usually post a day or two before games.</p>
        ) : (
          <div className={compact ? "grid gap-2 md:grid-cols-3" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"}>
            {list.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-line bg-slate-raised/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold leading-tight">{p.label}</div>
                    {p.kalshi && <div className="mt-0.5 text-xs font-medium text-info">(Kalshi: {p.kalshi})</div>}
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline">{p.league}</Badge>{p.detail}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold tabular-nums">{fmtAmerican(p.americanOdds)}</div>
                    <div className="text-[11px] text-muted-foreground">{p.book}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs tabular-nums">
                  <span><span className="text-neon">{fmtPct(p.modelProb, 0)} model</span> <span className="text-muted-foreground">vs {fmtPct(p.impliedProb, 0)} price</span></span>
                  <EdgePill edge={p.edge} />
                </div>
                {!compact && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{p.why}</p>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
