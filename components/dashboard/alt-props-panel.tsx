"use client";
import { useMemo, useState } from "react";
import type { MatchupCardData, PlayerProp } from "@/types/sports";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { fmtAmerican, fmtPct } from "@/lib/utils";
import { EdgePill } from "./edge-pill";
import { kalshiPropPhrase } from "@/lib/kalshi-terms";
import { ConfidenceMeter } from "./confidence-meter";

export function AltPropsPanel({ props, matchups, altSpreads = true }: { props: PlayerProp[]; matchups: MatchupCardData[]; altSpreads?: boolean }) {
  const [tab, setTab] = useState("props");
  const main = props.filter((p) => !p.isAlt);
  const alts = props.filter((p) => p.isAlt);
  const altGame = useMemo(
    () => matchups.flatMap((m) => [m.recommended, ...m.otherBets, ...(m.altLadders ?? [])].filter((b) => b.altLines?.length).map((b) => ({ m, b }))),
    [matchups],
  );
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
        <div>
          <CardTitle>Alt lines &amp; player props</CardTitle>
          <CardDescription>Each line is priced from a stat projection, so alt rungs get their own fair odds instead of copying the book.</CardDescription>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="props">Player props ({main.length})</TabsTrigger>
            <TabsTrigger value="alt-props">Alt props ({alts.length})</TabsTrigger>
            {altSpreads && <TabsTrigger value="alt-game">Alt spreads &amp; totals</TabsTrigger>}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <Tabs value={tab}>
          <TabsContent value="props" className="mt-0"><PropGrid list={main} /></TabsContent>
          <TabsContent value="alt-props" className="mt-0"><PropGrid list={alts} /></TabsContent>
          <TabsContent value="alt-game" className="mt-0 space-y-4">
            {altGame.map(({ m, b }) => (
              <div key={b.id}>
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <Badge variant="outline">{m.matchup.league}</Badge>
                  <span className="font-semibold">{b.label}</span>
                  <span className="text-muted-foreground">{b.market.startsWith("alt_") ? `${b.bestQuote.bookmaker.name} ladder · ${m.matchup.away.shortName} @ ${m.matchup.home.shortName}` : `main line ${fmtAmerican(b.bestQuote.americanOdds)}`}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {b.altLines!.map((a) => (
                    <div key={a.line} className="rounded-lg border border-slate-line bg-slate-raised/40 p-3">
                      <div className="text-xs text-muted-foreground tabular-nums">{b.market.includes("total") ? `${b.side === "over" ? "Over" : "Under"} ${a.line}` : `${a.line > 0 ? "+" : ""}${a.line}`}</div>
                      <div className="text-lg font-bold tabular-nums">{fmtAmerican(a.americanOdds)}</div>
                      <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{fmtPct(a.modelProb, 0)} model</span><EdgePill edge={a.edge} /></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function PropGrid({ list }: { list: PlayerProp[] }) {
  if (!list.length) return <p className="py-6 text-sm text-muted-foreground">None for this day yet. Kalshi usually posts player props a day or two before games; sportsbook props need Odds API credits.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {list.map((p) => (
        <div key={p.id} className="rounded-lg border border-slate-line bg-slate-raised/40 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">{p.playerName}</div>
              <div className="text-xs text-muted-foreground">{p.team}{p.position ? ` · ${p.position}` : ""}</div>
            </div>
            <EdgePill edge={p.edge} />
          </div>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <div className="text-xs text-muted-foreground">{p.source === "kalshi" ? "Kalshi ladder" : p.statLabel}{p.isAlt && <Badge variant="secondary" className="ml-1.5">Alt</Badge>}</div>
              {p.source !== "kalshi" && <div className="text-[11px] font-medium text-info">(Kalshi: {kalshiPropPhrase(p.playerName, `${Math.ceil(p.line)}+ ${p.statLabel.toLowerCase()}`, p.side)})</div>}
              <div className="text-xl font-bold">{p.source === "kalshi" ? `${p.side === "over" ? "Yes" : "No"} · ${p.statLabel}` : `${p.side === "over" ? "Over" : "Under"} ${p.line}`}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold tabular-nums">{fmtAmerican(p.bestQuote.americanOdds)}</div>
              <div className="text-xs text-muted-foreground">{p.bestQuote.bookmaker.name}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground tabular-nums">Projection {p.projection.mean.toFixed(1)} · model {fmtPct(p.modelProb, 0)} vs {fmtPct(p.impliedProb, 0)}</div>
          {p.flags?.includes("large_gap") && <p className="mt-1 text-xs font-semibold text-warn">Far from the market (8+ pts): usually a hot or cold streak or missing news, so it's not recommended</p>}
          {p.matchupNote && <p className="mt-1 text-xs text-foreground/80">{p.matchupNote}</p>}
          <ConfidenceMeter tier={p.confidence} className="mt-3" />
        </div>
      ))}
    </div>
  );
}
