"use client";
/** Hunter Sports Plus pages: Today, a page per game, Best Bets, Props, Parlays, Our Picks. */
import { useState } from "react";
import Link from "next/link";
import type { MatchupCardData, PlayerProp, TeaserLeg } from "@/types/sports";
import type { LiveBundle } from "@/lib/live/assemble";
import { kickoff } from "@/lib/nfl";
import { cn, fmtPct } from "@/lib/utils";
import { LocksTable } from "@/components/dashboard/locks-table";
import { GameRow } from "@/components/board/game-row";
import { GameTile, TEASER_BREAKEVEN, TEASER_LEG_MIN, TeamLogo } from "./game-tile";
import { LoadPropsButton } from "./load-props";
import { altLineRows, BetList, lineRows, propRows, rank, usePropResults, ViewTabs, type BetRow, type View, PropKey } from "./bet-list";
import { ModelCheck } from "@/components/dashboard/model-check";
import { fmtAmerican, fmtUnits } from "@/lib/utils";
import { ParlayIdeas } from "./parlay-ideas";
import { MatchupBreakdown, setPropWhy } from "./why";
import { setLogs } from "./hit-chart";
import { alpha, colorOf } from "@/lib/team-colors";
import { inLg, sportColor, SPORTS, useLeague, type Lg } from "./league";
import { dayKey, dayLabel } from "@/lib/live/day";
import { LEAGUES } from "@/lib/leagues";

/** Games still to be played in the selected sport (lists, rankings and parlays use only these). */
const open = (cards: MatchupCardData[], lg: Lg = "ALL") => cards.filter((c) => c.matchup.status === "scheduled" && inLg(c.matchup.league, lg));
/** Every game on the board in the sport, started ones included (they stay up with their scores for about a day). */
const week = (cards: MatchupCardData[], lg: Lg = "ALL") => cards.filter((c) => inLg(c.matchup.league, lg));
const lgName = (lg: Lg) => (lg === "ALL" ? "All sports" : lg in SPORTS ? SPORTS[lg as keyof typeof SPORTS].label : LEAGUES[lg as keyof typeof LEAGUES]?.name ?? lg);

/** Every game line and prop on open games (ranking happens per view). */
const allRows = (cards: MatchupCardData[], props: PlayerProp[], lg: Lg = "ALL"): BetRow[] => {
  const games = open(cards, lg);
  return [...games.flatMap(lineRows), ...propRows(props, games)];
};
const isProp = (r: BetRow) => r.kind === "Prop" || r.kind === "Alt prop";
/** Anytime goalscorers: every one, most likely first (our chance when we have one, else the books'). They rarely
 * reach 55%, so they'd never show in the "most likely" lists; this is where they live. */
const scorerRows = (rows: BetRow[]) => rows.filter((r) => r.whyKey?.endsWith("|goals") && r.leg.side === "over")
  .sort((a, b) => (b.our ?? b.books) - (a.our ?? a.books));

function Title({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <header className="mb-6">
      {kicker && <div className="text-xs font-bold uppercase tracking-wider text-brand">{kicker}</div>}
      <h1 className="text-3xl font-black tracking-tight text-ink sm:text-4xl">{title}</h1>
      {sub && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{sub}</p>}
    </header>
  );
}

function Section({ title, href, link, children }: { title: string; href?: string; link?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b-2 border-ink pb-1.5">
        <h2 className="text-lg font-black uppercase tracking-wide text-ink">{title}</h2>
        {href && <Link href={href} className="text-sm font-bold text-brand hover:underline">{link} →</Link>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="rounded-lg border border-dashed border-slate-line bg-slate-card p-6 text-center text-sm text-muted-foreground">{text}</p>;

/** Filter chips (bet type, game). */
function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter">
      {options.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={cn("shrink-0 rounded-full border px-3 py-1 text-xs font-bold", value === k ? "border-ink bg-ink text-obsidian" : "border-slate-line bg-slate-card text-ink/70 hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------- This Week ----------------

export function WeekView({ bundle }: { bundle: LiveBundle }) {
  setPropWhy(bundle.propWhy); setLogs(bundle);
  const data = bundle.byDay.all;
  const { pick: league } = useLeague();
  const tz = bundle.tz;
  const all = week(data.matchups, league);
  const days = [...new Set(all.map((c) => dayKey(c.matchup.startTime, tz)))].sort();
  const today = bundle.todayKey;
  const [pick, setPick] = useState<string>("");
  const day = pick && days.includes(pick) ? pick : days.includes(today) ? today : days[0] ?? today;
  const dayGames = all.filter((c) => dayKey(c.matchup.startTime, tz) === day);
  const rows = allRows(dayGames, data.props, league);
  const tiles = [
    { k: "Games", v: dayGames.length, href: "#games" },
    { k: "Likely to hit", v: rank(rows, "likely").length, href: "/best-bets/" },
    { k: "We like more", v: rank(rows, "likemore").length, href: "/best-bets/" },
    { k: "Longshots", v: rank(rows, "longshots").length, href: "/best-bets/" },
  ];
  // one section per league, in order of first start
  const groups = [...new Set(dayGames.map((c) => c.matchup.league))]
    .map((lg) => ({ lg, cards: dayGames.filter((c) => c.matchup.league === lg).sort((a, b) => a.matchup.startTime.localeCompare(b.matchup.startTime)) }))
    .sort((a, b) => a.cards[0].matchup.startTime.localeCompare(b.cards[0].matchup.startTime));
  return (
    <>
      <Title kicker={lgName(league)} title={dayLabel(day, today)} sub="Our read on every game: team strength, injuries, rest and back-to-backs, travel, starting pitchers and goalies, weather. Tap a game for its full list." />
      {days.length > 1 && <Chips value={day} onChange={setPick} options={days.map((d) => [d, dayLabel(d, today)] as [string, string])} />}
      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.k} href={t.href} className="rounded-xl border border-slate-line bg-slate-card p-4 hover:bg-slate-raised">
            <div className="text-3xl font-black tabular-nums text-ink">{t.v}</div>
            <div className="text-sm font-semibold text-muted-foreground">{t.k}</div>
          </Link>
        ))}
      </div>
      {rows.length > 0 && (
        <Section title="Most likely to hit" href="/best-bets/" link="Top 25">
          <BetList rows={rank(rows, "likely").slice(0, 5)} />
        </Section>
      )}
      {scorerRows(rows).length > 0 && (
        <Section title="Top goalscorer picks" href="/props/" link="All goalscorers">
          <BetList rows={scorerRows(rows).slice(0, 5)} />
        </Section>
      )}
      {rows.length > 0 && (
        <Section title="Parlay ideas" href="/parlays/" link="More parlays">
          <ParlayIdeas rows={rows} seed={bundle.generatedAt + league + day} count={2} />
        </Section>
      )}
      {!dayGames.length && <Empty text={`No ${lgName(league)} games on the board for this day yet.`} />}
      <div id="games" />
      {groups.map((g) => (
        <section key={g.lg} className="mb-10">
          <div className="mb-3 flex items-baseline justify-between gap-3 border-b-2 pb-1.5" style={{ borderColor: sportColor(g.lg) }}>
            <h2 className="text-lg font-black uppercase tracking-wide" style={{ color: sportColor(g.lg) }}>{LEAGUES[g.lg]?.name ?? g.lg}</h2>
            <span className="text-xs text-muted-foreground">{g.cards.length} game{g.cards.length === 1 ? "" : "s"}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{g.cards.map((c) => <GameTile key={c.matchup.id} card={c} />)}</div>
        </section>
      ))}
    </>
  );
}

// ---------------- Game page ----------------

export function GameView({ bundle, id }: { bundle: LiveBundle; id: string }) {
  setPropWhy(bundle.propWhy); setLogs(bundle);
  const data = bundle.byDay.all;
  const [view, setView] = useState<View>("likely");
  const [lines, setLines] = useState<"main" | "alt">("main");
  const propResults = usePropResults();
  const card = data.matchups.find((c) => c.matchup.id === id);
  if (!card) return <><Title title="Game not found" /><Empty text="This game isn't on the board anymore (it may have finished). Head back to This Week." /></>;
  const m = card.matchup;
  const props = propRows(data.props.filter((p) => p.matchupId === id), [card]);
  const mainRows = [...lineRows(card), ...props.filter((r) => r.kind === "Prop")];
  const altRows = [...altLineRows(card), ...props.filter((r) => r.kind === "Alt prop")];
  const rows = [...mainRows, ...altRows];
  const shown = rank(lines === "main" ? mainRows : altRows, view);
  const hasProps = rows.some((r) => r.kind === "Prop");
  const lean = card.prediction.modelVersion !== "market" ? card.prediction : null;
  const injuries = (["away", "home"] as const).map((s) => ({ team: m[s], list: card.factors[s].injuries.filter((i) => i.status !== "probable") }));
  const w = card.factors.weather;
  return (
    <>
      <Link href="/" className="mb-4 inline-block text-sm font-semibold text-brand hover:underline">← Today ({LEAGUES[m.league]?.name ?? m.league})</Link>
      <header className="relative mb-8 overflow-hidden rounded-xl border border-slate-line p-5"
        style={{ background: `linear-gradient(120deg, ${alpha(colorOf(m.away, m.league), 0.35)} 0%, #17191E 42%, #17191E 58%, ${alpha(colorOf(m.home, m.league), 0.35)} 100%)` }}>
        <span aria-hidden className="absolute inset-x-0 top-0 h-1.5" style={{ background: `linear-gradient(90deg, ${colorOf(m.away, m.league)} 0 50%, ${colorOf(m.home, m.league)} 50% 100%)` }} />
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
          <span>{m.week ? `Week ${m.week} · ` : ""}{kickoff(m.startTime)}</span>
          {m.status !== "scheduled" && <span className={cn("rounded px-1.5 py-0.5", m.status === "live" ? "bg-loss text-obsidian" : "bg-ink text-obsidian")}>{m.status === "live" ? "Live" : "Final"}{m.score ? ` · ${m.away.shortName} ${m.score.away}, ${m.home.shortName} ${m.score.home}` : ""}</span>}
        </div>
        <div className="flex items-center justify-between gap-4">
          {(["away", "home"] as const).map((s, i) => (
            <div key={s} className={cn("flex min-w-0 flex-1 items-center gap-3", i === 1 && "flex-row-reverse text-right")}>
              <TeamLogo team={m[s]} size={40} league={m.league} />
              <div className="min-w-0">
                <div className="break-words text-base font-black leading-tight text-ink sm:text-2xl">{m[s].shortName}</div>
                <div className="text-xs text-muted-foreground">{m[s].record ?? ""}{s === "home" ? " · home" : ""}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-line pt-3 text-sm text-muted-foreground">
          {m.venue && <span>{m.venue.name}{m.venue.city ? `, ${m.venue.city}` : ""}</span>}
          <span>{m.venue?.indoor ? "Indoors" : w ? `${Math.round(w.temperatureF)}°F · wind ${Math.round(w.windMph)} mph · ${Math.round(w.precipitationChance * 100)}% rain` : "Weather not in yet"}</span>
          {lean && <span>Our stats model: {m.home.shortName} {fmtPct(lean.homeWinProb, 0)} to win, {lean.projectedTotal.toFixed(1)} total points</span>}
        </div>
      </header>

      {(card.why?.length ?? 0) > 0 && (
        <Section title="Matchup breakdown">
          <MatchupBreakdown card={card} />
        </Section>
      )}
      <Section title="Our best bets for this game">
        <Chips value={lines} onChange={setLines} options={[["main", `Main lines (${mainRows.length})`], ["alt", `Alt lines (${altRows.length})`]]} />
        {lines === "main"
          ? <p className="-mt-2 mb-3 text-xs text-muted-foreground">Main spread, total and moneyline plus each player&apos;s normal prop line (what PrizePicks uses). <b className="text-neon">PP ✓</b> = our chance clears the ~58% a PrizePicks pick needs. PrizePicks lines can sit a half-point off the books, so check the number.</p>
          : <p className="-mt-2 mb-3 text-xs text-muted-foreground">Alt spreads and totals, alt props (like 25+ points) and Kalshi rungs.</p>}
        <ViewTabs view={view} onChange={setView} />
        <BetList rows={shown} showGame={false} results={propResults} empty={view === "longshots" ? "No longshot we like more than the books for this game." : "Nothing our model rates 55%+ at a playable price yet."} />
        {!hasProps && <p className="mt-2 text-sm text-muted-foreground">Props load at 7 AM Central for a few NBA, MLB and NHL games a day (the free odds credits only stretch so far).</p>}
        <LoadPropsButton compact />
      </Section>

      {scorerRows(props).length > 0 && (
        <Section title="Anytime goalscorers">
          <p className="-mt-1 mb-3 text-xs text-muted-foreground">Everyone the books price to score, most likely first. Our chance comes from his goals per match this season and his team&apos;s projected goals tonight (players outside the season&apos;s top scorers show the books&apos; chance).</p>
          <BetList rows={scorerRows(props)} showGame={false} results={propResults} />
        </Section>
      )}

      <Section title="Every book's price">
        <GameRow card={card} defaultOpen />
      </Section>



      <Section title="Injuries">
        <div className="grid gap-4 sm:grid-cols-2">
          {injuries.map(({ team, list }) => (
            <div key={team.id} className="rounded-lg border border-slate-line bg-slate-card p-4">
              <div className="mb-2 font-bold">{team.shortName}</div>
              {list.length ? (
                <ul className="space-y-1 text-sm">{list.map((i) => <li key={i.playerId + i.playerName} className="flex justify-between gap-2"><span>{i.playerName} <span className="text-muted-foreground">{i.position}</span></span><span className="capitalize text-muted-foreground">{i.status.replace("_", "-")}</span></li>)}</ul>
              ) : <p className="text-sm text-muted-foreground">No notable injuries listed.</p>}
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// ---------------- Best Bets ----------------

export function BestBetsView({ bundle }: { bundle: LiveBundle }) {
  setPropWhy(bundle.propWhy); setLogs(bundle);
  const data = bundle.byDay.all;
  const { pick: league } = useLeague();
  const rows = allRows(data.matchups, data.props, league);
  const [view, setView] = useState<View>("likely");
  const [kind, setKind] = useState<"all" | BetRow["kind"]>("all");
  const shown = rank(rows, view).filter((r) => kind === "all" || r.kind === kind).slice(0, 25);
  return (
    <>
      <Title kicker={`Best bets · ${lgName(league)}`} title="Top 25 right now" sub="Ranked by our chance: team strength, injuries, rest, travel, starters and weather." />
      <ViewTabs view={view} onChange={setView} />
      <Chips value={kind} onChange={setKind} options={[["all", "All"], ["Spread", "Spreads"], ["Total", "Totals"], ["Moneyline", "Moneylines"], ["Prop", "Props"], ["Alt prop", "Alt props"]]} />
      <BetList rows={shown} empty="Nothing matches yet; more fills in as props load." />
      {(data.locks?.length ?? 0) > 0 && <div className="mt-10"><Section title="Locks" href="/locks/" link="All locks"><LocksTable locks={data.locks!.slice(0, 5)} matchups={data.matchups} /></Section></div>}
    </>
  );
}

// ---------------- Props ----------------


export function PropsView({ bundle }: { bundle: LiveBundle }) {
  setPropWhy(bundle.propWhy); setLogs(bundle);
  const data = bundle.byDay.all;
  const { pick: league } = useLeague();
  const games = open(data.matchups, league);
  const all = propRows(data.props, games);
  const loaded = games.filter((c) => all.some((r) => r.card.matchup.id === c.matchup.id));
  const [game, setGame] = useState("all");
  const [view, setView] = useState<View>("likely");
  const shown = rank(all.filter((r) => game === "all" || r.card.matchup.id === game), view);
  return (
    <>
      <Title kicker={`Player props · ${lgName(league)}`} title="Props & alt props" sub="From FanDuel, Fliff, DraftKings and more, plus alt ladders. Our chance shows where we have player projections; the rest show the books' chance and best price." />
      <LoadPropsButton />
      <PropKey />
      {loaded.length > 0 && (
        <Chips value={game} onChange={setGame}
          options={[["all", `All games (${all.length})`], ...loaded.map((c) => [c.matchup.id, `${c.matchup.away.shortName} @ ${c.matchup.home.shortName}`] as [string, string])]} />
      )}
      {scorerRows(all.filter((r) => game === "all" || r.card.matchup.id === game)).length > 0 && (
        <Section title="Anytime goalscorers">
          <p className="-mt-1 mb-3 text-xs text-muted-foreground">Everyone the books price to score today, most likely first. Scorers rarely top 55%, so they live here instead of the lists below.</p>
          <BetList rows={scorerRows(all.filter((r) => game === "all" || r.card.matchup.id === game)).slice(0, 40)} />
        </Section>
      )}
      <ViewTabs view={view} onChange={setView} />
      <BetList rows={view === "likely" && !shown.length ? all.filter((r) => game === "all" || r.card.matchup.id === game).slice(0, 50) : shown} empty={`No props loaded yet: they load at 7 AM Central for a few NBA, MLB and NHL games a day (${loaded.length} of ${games.length} games so far).`} />
    </>
  );
}

// ---------------- O/U ----------------

/** Near even money: both sides between these prices (the "could go either way" lines). */
const EVEN: [number, number] = [-135, 115];
/** Our lean has to beat the books' chance by this much to count as a lean, not a coin flip. */
const LEAN_MIN = 0.02;

/**
 * Main over/unders that could go either way: every game's main total and every player's main prop line priced near
 * even money. For each one, the side we like (our chance vs the books'), biggest lean first; the rest are coin flips.
 */
export function TotalsPage({ bundle }: { bundle: LiveBundle }) {
  setPropWhy(bundle.propWhy); setLogs(bundle);
  const data = bundle.byDay.all;
  const lgCtx = useLeague() as unknown as { league: Lg; pick?: Lg };
  const league = (lgCtx.pick ?? lgCtx.league) as Lg;
  const [tab, setTab] = useState<"games" | "props">("games");
  const [show, setShow] = useState<"leans" | "all">("leans");
  const games = open(data.matchups, league);
  const even = (r: BetRow) => r.odds >= EVEN[0] && r.odds <= EVEN[1];
  // one row per line: the side with the higher chance by our numbers
  const pickSide = (rows: BetRow[], key: (r: BetRow) => string) => {
    const best = new Map<string, BetRow>();
    for (const r of rows) {
      if (r.our === undefined || !even(r)) continue;
      const k = key(r), cur = best.get(k);
      if (!cur || r.our - r.books > (cur.our ?? 0) - cur.books) best.set(k, r);
    }
    return [...best.values()].sort((x, y) => (y.our! - y.books) - (x.our! - x.books));
  };
  const gameRows = pickSide(games.flatMap(lineRows).filter((r) => r.kind === "Total"), (r) => r.card.matchup.id);
  const propRowsAll = pickSide(propRows(data.props, games).filter((r) => r.kind === "Prop" && !r.whyKey?.endsWith("|goals")), (r) => `${r.whyKey}|${r.leg.line}`);
  const list = tab === "games" ? gameRows : propRowsAll;
  const leans = list.filter((r) => r.our! - r.books >= LEAN_MIN);
  const shown = show === "leans" ? leans : list;
  return (
    <>
      <Title kicker={`Over / unders · ${lgName(league)}`} title="Coin flips we lean on" sub="Main over/unders priced near even money (-135 to +115), the ones that could go either way. For each, the side we like and by how much, biggest lean first. Expect 53-58% at best: these are close calls, so read Why? and the hit chart." />
      <Chips value={tab} onChange={setTab} options={[["games", `Game totals (${gameRows.length})`], ["props", `Player props (${propRowsAll.length})`]]} />
      <Chips value={show} onChange={setShow} options={[["leans", `We lean (${leans.length})`], ["all", `All, incl. no lean (${list.length})`]]} />
      <BetList rows={shown} empty={tab === "props" ? "No main-line props near even money with our number yet (props load at 7 AM Central)." : "No game totals near even money with our number yet."} />
      <p className="mt-3 text-[11px] text-muted-foreground">&quot;We lean&quot; = our chance beats the books&apos; by 2+ points. These are close to 50/50 by design; they won&apos;t show in Our Picks, which needs 65%+.</p>
    </>
  );
}

// ---------------- Parlays ----------------

export function ParlaysPage({ bundle }: { bundle: LiveBundle }) {
  setPropWhy(bundle.propWhy); setLogs(bundle);
  const data = bundle.byDay.all;
  const { pick: league } = useLeague();
  const [mode, setMode] = useState<"mixed" | "sure" | "locks" | "ml">("mixed");
  const rows = allRows(data.matchups, data.props, league);
  const mlRows = rows.filter((r) => r.kind === "Moneyline");
  return (
    <>
      <Title kicker="Parlays" title="Parlay ideas" sub="A fresh set every update from legs our model likes. Shuffle for more, or tap Add to slip to edit one." />
      <Chips value={mode} onChange={setMode} options={[["mixed", `Mixed · ${lgName(league)}`], ["sure", `Most confident · ${lgName(league)}`], ["locks", `Locks · ${lgName(league)}`], ["ml", `Moneylines only · ${lgName(league)}`]]} />
      {mode === "mixed" ? <ParlayIdeas rows={rows} seed={bundle.generatedAt + league} count={10} />
        : mode === "sure" ? <ParlayIdeas rows={rows} seed={bundle.generatedAt} count={16} mode="sure" />
        : mode === "locks" ? <ParlayIdeas rows={rows} seed={bundle.generatedAt} count={2} mode="locks" />
        : <ParlayIdeas rows={mlRows} seed={bundle.generatedAt + "ml"} count={10} mode="ml" />}
      {mode === "locks" ? <OurParlayRecord data={data} locks /> : <OurParlayRecord data={data} />}
    </>
  );
}

/** The site's own parlays: logged before each day's games, graded leg by leg. */
function OurParlayRecord({ data, locks = false }: { data: LiveBundle["byDay"]["all"]; locks?: boolean }) {
  const rec = locks ? data.lockParlayRecord : data.parlayRecord;
  const picks = (locks ? data.lockParlayPicks : data.parlayPicks) ?? [];
  const decided = rec ? rec.wins + rec.losses : 0;
  const tiles = [
    { k: "Record", v: rec ? `${rec.wins}-${rec.losses}${rec.pushes ? `-${rec.pushes}` : ""}` : "0-0" },
    { k: "Hit rate", v: decided ? `${Math.round((rec!.wins / decided) * 100)}%` : "—" },
    { k: "Units", v: rec ? fmtUnits(rec.unitsProfit) : "+0.00u", tone: rec && rec.unitsProfit < 0 ? "text-loss" : "text-neon" },
    { k: "ROI", v: rec && rec.picks ? `${(rec.roi * 100).toFixed(1)}%` : "—" },
  ];
  const mark = (r?: string) => (r === "win" ? <b className="text-neon">✓</b> : r === "loss" ? <b className="text-loss">✗</b> : r === "void" || r === "push" ? <b className="text-muted-foreground">void</b> : <span className="text-muted-foreground">•</span>);
  return (
    <div className="mt-12">
      <Section title={locks ? "Lock parlay record" : "Our parlay record"}>
        <p className="-mt-1 mb-4 text-sm text-muted-foreground">{locks
          ? "Each day, shortly before the first leg starts, the site logs its Lock 2-leg (and Lock 3-leg when it qualifies), 1 unit each at the best prices, graded automatically. Its own record, separate from everything else."
          : "Every day, shortly before the first games, the site logs its own Safest 2-leg, Safest 3-leg and Moneyline parlay (1 unit each, best prices) and grades them automatically. Separate from your bets and from Our Picks."}</p>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.k} className="rounded-xl border border-slate-line bg-slate-card p-4">
              <div className={cn("text-3xl font-black tabular-nums", t.tone)}>{t.v}</div>
              <div className="text-sm font-semibold text-muted-foreground">{t.k}</div>
            </div>
          ))}
        </div>
        {!picks.length && <Empty text="No parlays logged yet. The first ones log about an hour before the next games." />}
        <div className="grid gap-3 md:grid-cols-2">
          {picks.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-line bg-slate-card p-4 text-sm">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <div className="font-bold">{p.label.split(":")[0]} <span className="text-xs font-normal text-muted-foreground">{new Date(p.placedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span></div>
                <span className={cn("shrink-0 rounded px-2 py-0.5 text-xs font-bold", p.result === "win" ? "bg-neon/15 text-neon" : p.result === "loss" ? "bg-loss/15 text-loss" : "bg-slate-raised text-ink/70")}>
                  {p.result === "win" ? `✓ +${(p.profitUnits ?? 0).toFixed(2)}u` : p.result === "loss" ? "✗ -1u" : p.result === "pending" ? `${fmtAmerican(p.americanOdds)} · pending` : p.result}
                </span>
              </div>
              <ul className="space-y-1">
                {(p.grade?.legs ?? []).map((l, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2"><span className="min-w-0">{mark(l.result)} {l.label ?? l.side}</span><span className="shrink-0 tabular-nums text-muted-foreground">{fmtAmerican(l.americanOdds)}</span></li>
                ))}
              </ul>
              <div className="mt-2 text-[11px] text-muted-foreground">Our chance {Math.round(p.modelProb * 100)}% at {fmtAmerican(p.americanOdds)}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** Daily 5: the five bets we'd pick each day, logged from 8 AM Central, with their own record. */
function Daily5({ data }: { data: LiveBundle["byDay"]["all"] }) {
  const rec = data.daily5Record;
  const picks = data.daily5Picks ?? [];
  const decided = rec ? rec.wins + rec.losses : 0;
  const days = new Map<string, typeof picks>();
  for (const p of picks) { const d = p.id.split(":")[1] ?? ""; days.set(d, [...(days.get(d) ?? []), p]); }
  const [latest, ...older] = [...days.entries()];
  const row = (p: (typeof picks)[number]) => (
    <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="min-w-0"><div className="font-semibold">{p.label}</div><div className="text-xs text-muted-foreground">our chance {Math.round(p.modelProb * 100)}% · {fmtAmerican(p.americanOdds)}</div></div>
      <span className={cn("shrink-0 rounded px-2 py-0.5 text-xs font-bold", p.result === "win" ? "bg-neon/15 text-neon" : p.result === "loss" ? "bg-loss/15 text-loss" : "bg-slate-raised text-ink/70")}>
        {p.result === "win" ? `✓ +${(p.profitUnits ?? 0).toFixed(2)}u` : p.result === "loss" ? "✗ -1u" : p.result === "pending" ? "Pending" : p.result}
      </span>
    </li>
  );
  return (
    <Section title="Daily 5">
      <p className="-mt-1 mb-4 text-sm text-muted-foreground">The five bets we&apos;d actually pick each day: likely to hit and still beating the price, no props propped up by last season, spread across games. Logged from 8 AM Central, 1 unit each, graded automatically.</p>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-xl border border-brand/40 bg-slate-card p-4">
        <span className="text-3xl font-black tabular-nums">{rec ? `${rec.wins}-${rec.losses}${rec.pushes ? `-${rec.pushes}` : ""}` : "0-0"}</span>
        <span className="text-sm text-muted-foreground">{decided ? `${Math.round((rec!.wins / decided) * 100)}% hit` : "no picks graded yet"}</span>
        {rec && <span className={cn("text-sm font-bold tabular-nums", rec.unitsProfit < 0 ? "text-loss" : "text-neon")}>{fmtUnits(rec.unitsProfit)} · {(rec.roi * 100).toFixed(1)}% ROI</span>}
      </div>
      {!latest ? <Empty text="Today's Daily 5 logs from 8 AM Central." /> : (
        <>
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-brand">{latest[0] === dayKey(new Date().toISOString()) ? "Today" : latest[0]}</div>
          <ol className="mb-4 divide-y divide-slate-line overflow-hidden rounded-xl border border-slate-line bg-slate-card">{latest[1].map(row)}</ol>
          {older.length > 0 && (
            <details className="text-sm"><summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Earlier days ({older.length})</summary>
              {older.map(([d, list]) => (<div key={d} className="mt-3"><div className="mb-1 text-xs font-bold text-muted-foreground">{d}</div><ol className="divide-y divide-slate-line overflow-hidden rounded-xl border border-slate-line bg-slate-card">{list.map(row)}</ol></div>))}
            </details>
          )}
        </>
      )}
    </Section>
  );
}

// ---------------- Our Picks ----------------

/** Our own record: the top "most likely to hit" bets, logged automatically before each kickoff window. */
export function OurPicksPage({ bundle }: { bundle: LiveBundle }) {
  setPropWhy(bundle.propWhy); setLogs(bundle);
  const data = bundle.byDay.all;
  const rec = data.oursRecord;
  const picks = data.oursPicks ?? [];
  const { pick: league } = useLeague();
  const decided = rec ? rec.wins + rec.losses : 0;
  const settled = picks.filter((p) => p.result === "win" || p.result === "loss");
  const avgOur = settled.reduce((s, p, _, a) => s + p.modelProb / a.length, 0);
  // the hit rate these prices need to break even (average of each pick's implied chance)
  const needed = settled.reduce((s, p, _, a) => s + (p.americanOdds < 0 ? -p.americanOdds / (100 - p.americanOdds) : 100 / (p.americanOdds + 100)) / a.length, 0);
  const hit = decided ? rec!.wins / decided : 0;
  const tiles = [
    { k: "Record", v: rec ? `${rec.wins}-${rec.losses}${rec.pushes ? `-${rec.pushes}` : ""}` : "0-0" },
    { k: "Hit rate", v: decided ? `${Math.round(hit * 100)}%` : "—", tone: decided ? (hit >= needed ? "text-neon" : "text-loss") : undefined,
      sub: decided ? `need ${Math.round(needed * 100)}% to profit · we predicted ${Math.round(avgOur * 100)}%` : "" },
    { k: "Units", v: rec ? fmtUnits(rec.unitsProfit) : "+0.00u", tone: rec && rec.unitsProfit < 0 ? "text-loss" : "text-neon" },
    { k: "ROI", v: rec && rec.picks ? `${(rec.roi * 100).toFixed(1)}%` : "—" },
  ];
  const byDay = new Map<string, typeof picks>();
  for (const p of picks) { const d = new Date(p.placedAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); byDay.set(d, [...(byDay.get(d) ?? []), p]); }
  return (
    <>
      <Title kicker="Our picks" title="Our record" sub="About an hour before each game, the site logs that game's top 3 most-likely-to-hit bets (one per player, -175 or better), 1 unit each at the best price, and grades them automatically. Separate from your bets." />
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.k} className="rounded-xl border border-slate-line bg-slate-card p-4">
            <div className={cn("text-3xl font-black tabular-nums", t.tone)}>{t.v}</div>
            <div className="text-sm font-semibold text-muted-foreground">{t.k}</div>
            {t.sub && <div className="text-[11px] text-muted-foreground">{t.sub}</div>}
          </div>
        ))}
      </div>
      <Daily5 data={data} />
      <Section title="Since the 10/13 fixes" href="/tracker/" link="Best price log">
        <p className="-mt-1 mb-4 text-sm text-muted-foreground">Two ways to pick, judged on what each has done since the juice cap and the 3-point edge rule. Our Picks trusts our model; Best price trusts the market and shops for a better number. Give it 2-3 weeks before reading much into it.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {([["Our Picks", "our model's most likely bets that beat their price", data.oursRecordNew], ["Best price", "one book beats the other books' consensus", data.bestRecordNew]] as const).map(([name, what, r]) => {
            const d = r ? r.wins + r.losses : 0;
            return (
              <div key={name} className="rounded-xl border border-slate-line bg-slate-card p-4">
                <div className="font-black text-ink">{name}</div>
                <div className="mb-2 text-xs text-muted-foreground">{what}</div>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-2xl font-black tabular-nums">{r ? `${r.wins}-${r.losses}${r.pushes ? `-${r.pushes}` : ""}` : "0-0"}</span>
                  <span className="text-sm text-muted-foreground">{d ? `${Math.round((r!.wins / d) * 100)}% hit` : "no picks graded yet"}</span>
                  {r && <span className={cn("text-sm font-bold tabular-nums", r.unitsProfit < 0 ? "text-loss" : "text-neon")}>{fmtUnits(r.unitsProfit)} · {(r.roi * 100).toFixed(1)}% ROI</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      {data.oursCheck && data.oursCheck.picks > 0 && <div className="mb-10"><ModelCheck check={data.oursCheck} /></div>}
      {!picks.length && <Empty text="No picks logged yet. The first ones log about 2 hours before the next kickoff." />}
      {[...byDay.entries()].map(([day, list]) => (
        <Section key={day} title={day}>
          <ol className="divide-y divide-slate-line overflow-hidden rounded-xl border border-slate-line bg-slate-card">
            {list.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold">{p.label}</div>
                  <div className="text-xs text-muted-foreground">our chance {Math.round(p.modelProb * 100)}% · {fmtAmerican(p.americanOdds)}</div>
                </div>
                <span className={cn("shrink-0 rounded px-2 py-0.5 text-xs font-bold", p.result === "win" ? "bg-neon/15 text-neon" : p.result === "loss" ? "bg-loss/15 text-loss" : "bg-slate-raised text-ink/70")}>
                  {p.result === "win" ? `✓ +${(p.profitUnits ?? 0).toFixed(2)}u` : p.result === "loss" ? "✗ -1u" : p.result === "pending" ? "Pending" : p.result}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      ))}
      <p className="text-xs text-muted-foreground">The value-bet log (books paying more than the consensus) is on the <Link href="/tracker/" className="font-semibold text-brand hover:underline">Record</Link> page.</p>
    </>
  );
}
