import type { ReactNode } from "react";
import { Flame, Rocket, Shield, Link2 } from "lucide-react";
import type { MatchupCardData, Parlay, ParlayTier } from "@/types/sports";
import { kalshiPhrase } from "@/lib/kalshi-terms";
import { PARLAY_TIERS } from "@/lib/engine/parlays";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, fmtAmerican, fmtPct } from "@/lib/utils";
import { OpenInBuilder } from "./open-in-builder";

const STYLE: Record<ParlayTier, { icon: typeof Shield; accent: string }> = {
  bankroll_builder: { icon: Shield, accent: "text-neon" },
  value_booster: { icon: Rocket, accent: "text-info" },
  lotto: { icon: Flame, accent: "text-warn" },
  same_game: { icon: Link2, accent: "text-violet-300" },
};

/**
 * Parlays grouped by risk tier. `perTier` caps how many show in each tier (the dashboard shows the top one; the
 * parlay page shows them all). The first parlay in a tier is the strongest and the one the transparency log tracks.
 */
export function ParlayTiers({ parlays, matchups = [], perTier }: { parlays: Parlay[]; matchups?: MatchupCardData[]; perTier?: number }) {
  const game = new Map(matchups.map((m) => [m.matchup.id, `${m.matchup.league} · ${m.matchup.away.shortName} @ ${m.matchup.home.shortName}`]));
  const teams = new Map(matchups.map((m) => [m.matchup.id, m.matchup]));
  const kalshiOf = (refId: string, matchupId: string) => {
    const mt = teams.get(matchupId);
    const parts = refId.split(":");
    if (!mt || parts.length < 4 || parts[0] !== matchupId) return null;
    return kalshiPhrase(parts[1], parts[2], parts[3] === "" ? undefined : Number(parts[3]), mt.home.shortName, mt.away.shortName);
  };

  // dashboard: one card per tier, as before
  if (perTier === 1) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {PARLAY_TIERS.map((cfg) => {
          const p = parlays.find((x) => x.tier === cfg.tier);
          return <ParlayCard key={cfg.tier} tier={cfg.tier} p={p} header={<TierTitle tier={cfg.tier} />} game={game} kalshiOf={kalshiOf} matchups={matchups} />;
        })}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {PARLAY_TIERS.map((cfg) => {
        const list = parlays.filter((x) => x.tier === cfg.tier).slice(0, perTier);
        return (
          <section key={cfg.tier}>
            <div className="mb-3">
              <TierTitle tier={cfg.tier} count={list.length} />
            </div>
            {list.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {list.map((p, i) => (
                  <ParlayCard key={p.id} tier={cfg.tier} p={p} game={game} kalshiOf={kalshiOf} matchups={matchups}
                    header={<CardTitle className="text-sm text-muted-foreground">{p.tier === "same_game" ? p.title : `Option ${i + 1}`}{i === 0 && p.tier !== "same_game" ? " · top pick" : ""}</CardTitle>} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not enough qualifying legs today.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TierTitle({ tier, count }: { tier: ParlayTier; count?: number }) {
  const cfg = PARLAY_TIERS.find((t) => t.tier === tier)!;
  const { icon: Icon, accent } = STYLE[tier];
  return (
    <div>
      <CardTitle className={cn("flex items-center gap-2", accent)}><Icon className="h-4 w-4" />{cfg.label}{count ? <span className="text-xs font-normal text-muted-foreground">({count})</span> : null}</CardTitle>
      <p className="mt-1 text-xs text-muted-foreground">{cfg.minLegs}{cfg.maxLegs > cfg.minLegs ? `–${cfg.maxLegs}` : ""} legs · {cfg.description}</p>
    </div>
  );
}

function ParlayCard({ tier, p, header, game, kalshiOf, matchups }: {
  tier: ParlayTier; p?: Parlay; header: ReactNode; game: Map<string, string>; kalshiOf: (refId: string, matchupId: string) => string | null; matchups: MatchupCardData[];
}) {
  const { accent } = STYLE[tier];
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>{header}</div>
        {p && <div className="text-right"><div className="text-2xl font-bold tabular-nums">{fmtAmerican(p.combinedAmericanOdds)}</div></div>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {!p ? (
          <p className="text-sm text-muted-foreground">Not enough qualifying legs today.</p>
        ) : (
          <>
            <ol className="space-y-2">
              {p.legs.map((l, i) => (
                <li key={l.refId} className="flex items-center justify-between gap-3 rounded-md bg-slate-raised/50 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className="min-w-0"><span className="block truncate">{l.label}</span>
                      {kalshiOf(l.refId, l.matchupId) && <span className="block truncate text-[11px] font-medium text-info">(Kalshi: {kalshiOf(l.refId, l.matchupId)})</span>}
                      {game.get(l.matchupId) && <span className="block truncate text-xs text-muted-foreground">{game.get(l.matchupId)}</span>}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{fmtAmerican(l.americanOdds)}</span>
                </li>
              ))}
            </ol>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md border border-slate-line p-2"><dt className="text-muted-foreground">Model hit</dt><dd className={cn("text-base font-bold tabular-nums", accent)}>{fmtPct(p.modelHitProb)}</dd></div>
              <div className="rounded-md border border-slate-line p-2"><dt className="text-muted-foreground">Book implied</dt><dd className="text-base font-bold tabular-nums">{fmtPct(p.impliedHitProb)}</dd></div>
              <div className="rounded-md border border-slate-line p-2"><dt className="text-muted-foreground">EV / unit</dt><dd className={cn("text-base font-bold tabular-nums", p.expectedValue >= 0 ? "text-neon" : "text-loss")}>{p.expectedValue >= 0 ? "+" : ""}{p.expectedValue.toFixed(2)}</dd></div>
            </dl>
            {p.correlationFactor !== 1 && <p className="mt-2 text-xs text-muted-foreground">Correlation adjustment ×{p.correlationFactor.toFixed(2)}: these legs tend to win together.</p>}
            <p className="mt-2 text-xs text-muted-foreground">{p.rationale}</p>
            <OpenInBuilder parlay={p} matchups={matchups} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
