"use client";
import { useState } from "react";
import { Flame } from "lucide-react";
import type { TdCandidate } from "@/types/sports";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, fmtAmerican, fmtKickoff, fmtPct } from "@/lib/utils";
import { EdgePill } from "./edge-pill";

type Mode = "likely" | "value" | "longshots";

/**
 * `modelOnly` (Hunter's Sauce): show each player's chance and fair price but no "value" tab or edge, since the
 * chances come from our own player model, not the books, and haven't proven themselves.
 */
export function TdDerby({ list, modelOnly = false }: { list: TdCandidate[]; modelOnly?: boolean }) {
  const [mode, setMode] = useState<Mode>("likely");
  const shown = (mode === "likely" ? list
    : mode === "value" ? list.filter((t) => t.edge !== undefined && t.edge > 0).sort((a, b) => b.edge! - a.edge!)
    : list.filter((t) => t.prob < 0.32 && t.prob >= 0.15).sort((a, b) => b.prob - a.prob)).slice(0, 20);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><Flame className="h-4 w-4 text-warn" /> TD derby</CardTitle>
          <CardDescription>
            Chance each player scores a touchdown (rushing or receiving): his TD rate, how many the defense allows to his position,
            and how many points the model expects his team to score. Players listed as out are left off.
          </CardDescription>
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="likely">Most likely</TabsTrigger>
            {!modelOnly && <TabsTrigger value="value">Best value</TabsTrigger>}
            <TabsTrigger value="longshots">Longshots</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {!shown.length ? (
          <p className="py-6 text-sm text-muted-foreground">
            {mode === "value" ? "No player is priced below his fair odds right now (prices come from Kalshi's anytime-TD markets when listed)." : "No NFL games for this day."}
          </p>
        ) : (
          <ol className="divide-y divide-slate-line">
            {shown.map((t, i) => (
              <li key={t.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-3">
                <span className="w-6 text-right text-sm font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{t.player} <span className="text-xs font-normal text-muted-foreground">{t.pos} · {t.team} vs {t.opponent} · {fmtKickoff(t.start)}</span></div>
                  <div className="text-[11px] font-medium text-info">(Kalshi: Yes · {t.player}: 1+ touchdowns)</div>
                  <p className="text-xs text-muted-foreground">{t.note}</p>
                </div>
                <div className="text-right">
                  <div className={cn("text-xl font-bold tabular-nums", t.prob >= 0.45 && "text-neon")}>{fmtPct(t.prob, 0)}</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">fair {fmtAmerican(t.fairOdds)}</div>
                  {t.price && (
                    <div className="mt-1 flex items-center justify-end gap-1.5 text-xs tabular-nums">
                      <span>{t.price.book} {fmtAmerican(t.price.americanOdds)}</span>
                      {t.edge !== undefined && !modelOnly && <EdgePill edge={t.edge} />}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          &quot;Fair&quot; is the price that matches our chance{modelOnly ? "; it's a guide from our player model, not a sportsbook consensus" : ". A listed price better than fair is value"}. Touchdowns are the most random stat in football, so even the top names score only about half the time.
        </p>
      </CardContent>
    </Card>
  );
}
