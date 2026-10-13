"use client";
import { useState } from "react";
import { CloudRain, HeartPulse, MapPin, Moon, Swords, TrendingUp, UserRound, BarChart3 } from "lucide-react";
import type { FactorTrigger, MatchupCardData } from "@/types/sports";
import { LEAGUES } from "@/lib/leagues";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn, fmtAmerican, fmtKickoff, fmtPct } from "@/lib/utils";
import { kalshiPhrase } from "@/lib/kalshi-terms";
import { ConfidenceMeter } from "./confidence-meter";
import { EdgePill } from "./edge-pill";

const ICON: Record<FactorTrigger["category"], typeof MapPin> = {
  ratings: BarChart3, injury: HeartPulse, rest: Moon, travel: MapPin, weather: CloudRain, head_to_head: Swords, venue: MapPin, starter: UserRound,
};

export function MatchupCard({ data }: { data: MatchupCardData }) {
  const { matchup: m, prediction: p, recommended: r, otherBets } = data;
  const [showAlt, setShowAlt] = useState(false);
  const league = LEAGUES[m.league];
  const unit = ["football", "basketball"].includes(league.sport) ? "pts" : league.sport === "baseball" ? "runs" : league.sport === "hockey" || league.sport === "soccer" ? "goals" : "";
  const alt = r.altLines ?? otherBets.find((b) => b.altLines)?.altLines;
  const live = m.status === "live";

  return (
    <Card className="flex flex-col overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-line px-5 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{m.league}</Badge>
          <span>{live ? <span className="font-semibold text-neon">● Live {m.score?.clock}</span> : fmtKickoff(m.startTime)}</span>
        </div>
        {m.venue && <span className="truncate">{m.venue.name}</span>}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-4">
        <Team name={m.away.shortName} record={m.away.record} prob={p.awayWinProb} favored={p.awayWinProb > p.homeWinProb} score={m.score?.away} />
        <div className="text-center text-xs text-muted-foreground">
          {league.individual ? "vs" : "@"}
          {p.drawProb != null && <div className="mt-1 tabular-nums">Draw {fmtPct(p.drawProb, 0)}</div>}
        </div>
        <Team name={m.home.shortName} record={m.home.record} prob={p.homeWinProb} favored={p.homeWinProb > p.awayWinProb} score={m.score?.home} right />
      </div>

      {/* win probability bar */}
      <div className="mx-5 flex h-1.5 overflow-hidden rounded-full bg-slate-raised" aria-hidden>
        <div className="bg-muted-foreground/60" style={{ width: `${p.awayWinProb * 100}%` }} />
        {p.drawProb != null && <div className="bg-slate-line" style={{ width: `${p.drawProb * 100}%` }} />}
        <div className="bg-neon" style={{ width: `${p.homeWinProb * 100}%` }} />
      </div>
      {!league.individual && unit && (
        <p className="px-5 pt-2 text-xs text-muted-foreground tabular-nums">
          Projected {m.away.shortName} {p.projectedScore.away.toFixed(unit === "pts" ? 0 : 1)}, {m.home.shortName} {p.projectedScore.home.toFixed(unit === "pts" ? 0 : 1)} ({p.projectedTotal.toFixed(1)} total)
        </p>
      )}

      {/* AI recommended pick (pregame only) */}
      {live ? (
        <div className="m-5 mb-3 rounded-lg border border-slate-line p-4 text-sm text-muted-foreground">
          In progress. Pregame picks are closed; live pricing needs a live-odds feed (see lib/services/odds-api.ts).
        </div>
      ) : (
      <div className="m-5 mb-3 rounded-lg border border-neon/30 bg-neon/[0.06] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-neon"><TrendingUp className="h-3.5 w-3.5" /> Recommended pick</div>
            <div className="mt-1 text-lg font-bold leading-tight">{r.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{r.bestQuote.bookmaker.name} · model {fmtPct(r.modelProb)} vs {fmtPct(r.impliedProb)} implied</div>
            {(() => { const k = kalshiPhrase(r.market, r.side, r.line, m.home.shortName, m.away.shortName); return k ? <div className="mt-0.5 text-xs font-medium text-info">(Kalshi: {k})</div> : null; })()}
            {r.flags?.includes("large_gap") && <div className="mt-1 text-xs font-semibold text-warn">Big gap vs. the market: check injury and lineup news first</div>}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">{fmtAmerican(r.bestQuote.americanOdds)}</div>
            <EdgePill edge={r.edge} className="mt-1" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <ConfidenceMeter tier={r.confidence} />
          {alt && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              Alt lines <Switch checked={showAlt} onCheckedChange={setShowAlt} aria-label="Show alt lines" />
            </label>
          )}
        </div>
        {showAlt && alt && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {alt.map((a) => (
              <div key={a.line} className="rounded-md border border-slate-line bg-obsidian/60 p-2 text-center">
                <div className="text-xs text-muted-foreground tabular-nums">
                  {r.side === "over" || r.side === "under" ? `${r.side === "over" ? "O" : "U"} ${a.line}` : a.line > 0 ? `+${a.line}` : a.line}
                </div>
                <div className="font-semibold tabular-nums">{fmtAmerican(a.americanOdds)}</div>
                <div className={cn("text-[11px] font-semibold tabular-nums", a.edge >= 0 ? "text-neon" : "text-loss")}>{a.edge >= 0 ? "+" : ""}{(a.edge * 100).toFixed(1)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* other markets */}
      {!live && otherBets.length > 0 && (
        <div className="flex flex-wrap gap-2 px-5 pb-3">
          {otherBets.slice(0, 4).map((b) => (
            <span key={b.id} className="rounded-md border border-slate-line px-2 py-1 text-xs tabular-nums">
              {b.label} <span className="text-muted-foreground">{fmtAmerican(b.bestQuote.americanOdds)}</span>{" "}
              <span className={b.edge >= 0 ? "text-neon" : "text-loss"}>{b.edge >= 0 ? "+" : ""}{(b.edge * 100).toFixed(1)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Matchup Analysis */}
      <Accordion type="single" collapsible className="mt-auto px-5">
        <AccordionItem value="analysis">
          <AccordionTrigger>Matchup analysis</AccordionTrigger>
          <AccordionContent>
            <ul className="space-y-2.5">
              {p.triggers.map((t) => {
                const Icon = ICON[t.category];
                return (
                  <li key={t.label} className="flex gap-3">
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.severity === "high" ? "text-warn" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{t.label}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {t.marginImpact !== 0 && `${m.home.shortName} ${t.marginImpact > 0 ? "+" : ""}${t.marginImpact.toFixed(2)}`}
                          {t.totalImpact ? ` · total ${t.totalImpact > 0 ? "+" : ""}${t.totalImpact.toFixed(1)}` : ""}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{t.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            {data.factors.keyStarters?.note && <p className="mt-3 text-xs text-muted-foreground">{data.factors.keyStarters.note}</p>}
            <p className="mt-3 text-xs text-muted-foreground">{r.rationale} Model {p.modelVersion}, confidence {Math.round(p.confidence * 100)}/100.</p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

function Team({ name, record, prob, favored, score, right }: { name: string; record?: string; prob: number; favored: boolean; score?: number; right?: boolean }) {
  return (
    <div className={cn("min-w-0", right && "text-right")}>
      <div className={cn("truncate text-lg font-bold", favored ? "text-foreground" : "text-muted-foreground")}>{name}</div>
      <div className="text-xs text-muted-foreground">{record}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", favored && "text-neon")}>{score ?? fmtPct(prob, 0)}</div>
    </div>
  );
}
