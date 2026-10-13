"use client";
/**
 * Page bodies that follow the selected day. Each page passes the whole bundle; the view picks the day's slice.
 */
import { useState } from "react";
import type { LiveBundle } from "@/lib/live/assemble";
import { LEAGUES } from "@/lib/leagues";
import { rankValueBets } from "@/lib/engine/value";
import { dayLabel } from "@/lib/live/day";
import { useDay } from "./day-context";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatStrip } from "@/components/dashboard/stat-strip";
import { EvPicksTable } from "@/components/dashboard/ev-picks-table";
import { LocksRecord, LocksTable } from "@/components/dashboard/locks-table";
import { MatchupCard } from "@/components/dashboard/matchup-card";
import { ParlayTiers } from "@/components/dashboard/parlay-tiers";
import { AltPropsPanel } from "@/components/dashboard/alt-props-panel";
import { AltPicks } from "@/components/dashboard/alt-picks";
import { TdDerby } from "@/components/dashboard/td-derby";
import { TrackRecord } from "@/components/dashboard/track-record";
import { ModelCheck } from "@/components/dashboard/model-check";
import { PickCard } from "@/components/dashboard/pick-card";
import { FinalScores } from "@/components/dashboard/final-scores";
import { Badge } from "@/components/ui/badge";

function useSlice(bundle: LiveBundle) {
  const { day, todayKey } = useDay();
  const data = bundle.byDay[day] ?? bundle.byDay.all;
  const label = day === "all" ? "This week" : dayLabel(day, todayKey);
  return { data, label, day };
}

const Empty = ({ label }: { label: string }) => (
  <div className="rounded-xl border border-dashed border-slate-line p-8 text-center text-sm text-muted-foreground">
    No priced games for {label.toLowerCase() === "this week" ? "this week" : label} yet. Lines usually post a few days out; try another day.
  </div>
);

export function DashboardView({ bundle }: { bundle: LiveBundle }) {
  const { data, label } = useSlice(bundle);
  const clean = (m: (typeof data.matchups)[number]) => (m.recommended.flags?.includes("large_gap") ? 0 : 1);
  const featured = [...data.matchups].filter((m) => m.matchup.status === "scheduled")
    .sort((a, b) => clean(b) - clean(a) || Math.min(b.recommended.edge, 0.1) - Math.min(a.recommended.edge, 0.1)).slice(0, 6);
  return (
    <>
      <PageHeader title={`${label}'s board`.replace("This week's", "This week's")} subtitle="Each pick starts from the sportsbooks' fair price, then the model (team strength, injuries, rest, travel, weather) nudges it. Picks show where that beats the best available price." />
      {/* what to bet first, the record second */}
      {(data.locks?.length ?? 0) > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold">{label === "This week" ? "This week's" : `${label}'s`} locks</h2>
            <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/locks/`} className="text-sm font-semibold text-neon">All locks →</a>
          </div>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {data.locks!.slice(0, 3).map((b) => (
              <PickCard key={b.id} bet={b} card={data.matchups.find((m) => m.matchup.id === b.matchupId)}
                stats={[{ label: "Hit chance", value: <span className="text-neon">{Math.round(b.modelProb * 100)}%</span> }, { label: "Book implied", value: `${Math.round(b.impliedProb * 100)}%` }]} />
            ))}
          </ul>
        </section>
      )}
      <StatStrip data={data} />
      {data.matchups.length === 0 ? <div className="mt-6"><Empty label={label} /></div> : (
        <>
          <section className="mt-6"><EvPicksTable picks={data.topPicks} matchups={data.matchups} limit={6} /></section>
          <section className="mt-8">
            <h2 className="mb-3 text-lg font-bold">Featured matchups</h2>
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{featured.map((m) => <MatchupCard key={m.matchup.id} data={m} />)}</div>
          </section>
          <FinalScores graded={data.recentResults} />
          {(data.altPicks?.length ?? 0) > 0 && <section className="mt-8"><AltPicks picks={data.altPicks!} limit={6} compact /></section>}
          <section className="mt-8">
            <h2 className="mb-3 text-lg font-bold">{label === "This week" ? "Parlays" : `${label}'s parlays`}</h2>
            <ParlayTiers parlays={data.parlays} matchups={data.matchups} perTier={1} />
          </section>
          <section className="mt-8 grid gap-4 xl:grid-cols-[1fr_420px]">
            <AltPropsPanel props={data.props} matchups={data.matchups} />
            <TrackRecord summary={data.trackRecord} recent={data.recentResults} />
          </section>
        </>
      )}
    </>
  );
}

export function EvPicksView({ bundle }: { bundle: LiveBundle }) {
  const { data, label } = useSlice(bundle);
  const all = rankValueBets(data.matchups.filter((m) => m.matchup.status === "scheduled").flatMap((m) => [m.recommended, ...m.otherBets]));
  return (
    <>
      <PageHeader title={`+EV picks: ${label}`} subtitle="Every single bet where the model's probability beats the best available price by at least the minimum edge." />
      {all.length ? <EvPicksTable picks={all} matchups={data.matchups} /> : <Empty label={label} />}
    </>
  );
}

export function LocksView({ bundle }: { bundle: LiveBundle }) {
  const { data, label } = useSlice(bundle);
  const locks = data.locks ?? [];
  return (
    <>
      <PageHeader title={`Locks: ${label}`} subtitle="The bets most likely to hit, not the most profitable. They pay little, so they only make money if they hit even more often than their short prices assume." />
      <LocksRecord summary={data.locksRecord} />
      {locks.length ? <LocksTable locks={locks} matchups={data.matchups} />
        : data.matchups.length ? <div className="rounded-xl border border-dashed border-slate-line p-8 text-center text-sm text-muted-foreground">No locks for {label === "This week" ? "this week" : label.toLowerCase()}: nothing clears 62% at a fair price. That&apos;s the filter working, not a bug.</div>
        : <Empty label={label} />}
    </>
  );
}

export function AltPropsView({ bundle, repo }: { bundle: LiveBundle; repo?: string }) {
  const { data, label, day } = useSlice(bundle);
  const { setDay, todayKey } = useDay();
  const propDays = bundle.days.filter((d) => (bundle.byDay[d]?.props.length ?? 0) > 0);
  const loaded = bundle.propsLoadedAt ? new Date(bundle.propsLoadedAt) : null;
  return (
    <>
      <PageHeader title={`Alt lines & props: ${label}`} subtitle="Player props, alt props and alt spreads/totals, each priced from its own projection." />
      {!bundle.isMock && repo && <LoadPropsCard repo={repo} />}
      {!bundle.isMock && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Kalshi props and alt lines update every 30 minutes (free). {loaded ? `Sportsbook props last loaded ${loaded.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Sportsbook props (Odds API) haven't loaded yet."}</span>
          {data.props.length === 0 && propDays.length > 0 && day !== "all" && (
            <>
              <span>None for {label.toLowerCase() === "today" ? "today" : label}. Props are on:</span>
              {propDays.map((d) => (
                <button key={d} onClick={() => setDay(d)} className="rounded-md border border-neon/50 px-2 py-0.5 text-xs font-semibold text-neon hover:bg-neon/10">
                  {dayLabel(d, todayKey)} ({bundle.byDay[d].props.length})
                </button>
              ))}
            </>
          )}
        </div>
      )}
      <div className="mb-4"><AltPicks picks={data.altPicks ?? []} /></div>
      <AltPropsPanel props={data.props} matchups={data.matchups} />
    </>
  );
}

/** Props refresh once a day to save API credits; this card links to the manual "Load props now" run. */
function LoadPropsCard({ repo }: { repo: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 rounded-xl border border-slate-line bg-slate-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Sportsbook props refresh once a day (9 AM Central)</div>
          <p className="text-sm text-muted-foreground">Want them now, like after injury news? Load them manually. Each load uses about 9 of your 500 free monthly credits.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(!open)} className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{open ? "Hide steps" : "How?"}</button>
          <a href={`https://github.com/${repo}/actions/workflows/deploy.yml`} target="_blank" rel="noreferrer"
            className="inline-flex h-9 items-center rounded-lg bg-neon px-4 text-sm font-semibold text-obsidian hover:bg-neon-dim">Load props now ↗</a>
        </div>
      </div>
      {open && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Tap <b className="text-foreground">Load props now</b> (opens GitHub; sign in if asked).</li>
          <li>Tap <b className="text-foreground">Run workflow</b> on the right.</li>
          <li>Check <b className="text-foreground">Load player props now</b>, then tap the green <b className="text-foreground">Run workflow</b>.</li>
          <li>Wait about 3 minutes for the green check, then refresh this page.</li>
        </ol>
      )}
    </div>
  );
}

export function ParlaysView({ bundle }: { bundle: LiveBundle }) {
  const { data, label } = useSlice(bundle);
  return (
    <>
      <PageHeader title={`AI parlay generator: ${label}`} subtitle="Up to five options in each risk tier, built only from the selected day's games and fairly priced legs. Cross-game legs are treated as independent. More parlays means more choice, not more edge: every leg you add multiplies the sportsbook's margin." />
      {data.matchups.length ? <ParlayTiers parlays={data.parlays} matchups={data.matchups} /> : <Empty label={label} />}
    </>
  );
}

export function LeaguesView({ bundle }: { bundle: LiveBundle }) {
  const { data, label } = useSlice(bundle);
  const groups = Object.values(LEAGUES).map((l) => ({ league: l, games: data.matchups.filter((m) => m.matchup.league === l.id) })).filter((g) => g.games.length);
  return (
    <>
      <PageHeader title={`League explorer: ${label}`} subtitle="Every covered league with games on the selected day." />
      {!groups.length && <Empty label={label} />}
      {groups.map(({ league, games }) => (
        <section key={league.id} className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">{league.name} <Badge variant="outline">{games.length} {games.length === 1 ? "game" : "games"}</Badge></h2>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{games.map((m) => <MatchupCard key={m.matchup.id} data={m} />)}</div>
        </section>
      ))}
    </>
  );
}

export function TrackerView({ bundle }: { bundle: LiveBundle }) {
  const data = bundle.byDay.all;
  const [straight, setStraight] = useState(false);
  const summary = straight && data.straightRecord ? data.straightRecord : data.trackRecord;
  const recent = straight ? data.recentResults.filter((p) => p.kind === "single" || p.kind === "alt") : data.recentResults;
  return (
    <>
      <PageHeader title="Transparency tracker" subtitle="How the current model's recommendations have actually done, by bet type. Graded automatically from final scores, Kalshi results and player stats." />
      <StatStrip data={data} />
      {data.modelCheck && <div className="mt-6 max-w-3xl"><ModelCheck check={data.modelCheck} /></div>}
      <div className="mt-6 flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-semibold">{straight ? "Straight picks only" : "All bet types"}: </span>
          <span className="tabular-nums text-muted-foreground">{summary.wins}-{summary.losses}{summary.pushes ? `-${summary.pushes}` : ""} · {summary.unitsProfit >= 0 ? "+" : ""}{summary.unitsProfit.toFixed(2)}u</span>
        </div>
        <div className="inline-flex rounded-lg border border-slate-line p-0.5 text-xs font-semibold" role="group" aria-label="Which picks to count">
          {([[false, "All bets"], [true, "Straight picks only"]] as const).map(([v, label]) => (
            <button key={label} type="button" aria-pressed={straight === v} onClick={() => setStraight(v)}
              className={straight === v ? "rounded-md bg-neon/10 px-3 py-1.5 text-neon" : "rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground"}>{label}</button>
          ))}
        </div>
      </div>
      {straight && <p className="mt-1 max-w-3xl text-xs text-muted-foreground">Game picks and alt lines only. Parlays and props are hidden; locks have their own record on the Locks page.</p>}
      <div className="mt-3 max-w-3xl"><TrackRecord summary={summary} recent={recent} legacy={data.legacyRecord}
        paused={bundle.status.notes.filter((n) => n.startsWith("Paused: ")).map((n) => n.replace(/^Paused: (.+?) picks\..*$/, "$1"))} /></div>
    </>
  );
}

export function TdDerbyView({ bundle }: { bundle: LiveBundle }) {
  const { data, label } = useSlice(bundle);
  return (
    <>
      <PageHeader title={`TD derby: ${label}`} subtitle="Who's most likely to find the end zone, with fair odds and the best listed price." />
      {bundle.isMock ? <p className="text-sm text-muted-foreground">The TD derby uses live NFL player stats, so it appears once the live data builder runs.</p>
        : <TdDerby list={data.tdDerby ?? []} />}
    </>
  );
}
