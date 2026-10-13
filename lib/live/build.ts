/**
 * Live data builder (runs in GitHub Actions every 30 minutes).
 *   Games + prices:  ESPN, Action Network, MLB.com, NHL.com, NBA.com, Kalshi, Polymarket (free)
 *                    The Odds API only as a backup for missing lines (costs credits)
 *   Team strength:   nflverse EPA (NFL), MoneyPuck xG (NHL), MLB standings, CollegeFootballData SP+ and
 *                    football-data.org (free keys), ESPN season scoring as the fallback
 *   Situation:       ESPN injuries, rest from the schedule, travel and weather from Open-Meteo
 * Then: engine -> priced picks -> day-by-day bundle, plus the transparency log.
 */
import type { GameResults, LeagueId, MarketOutcome, MatchupCardData, PickResult, Prediction, TeaserLeg, MatchupFactors, OddsQuote, PlayerProp, TeamRatings, TrackedPick, ValueBet, WhyPart } from "@/types/sports";
import { LEAGUES } from "@/lib/leagues";
import { paramsFor } from "@/lib/engine/sport-params";
import { predict } from "@/lib/engine/probability";
import { toValueBet } from "@/lib/engine/value";
import { settleProfit } from "@/lib/engine/track-record";
import { ESPN_PATHS, espnVariant, getGames, getOdds, getRosterNames, getSummary, getTeamRatings, type EspnGame } from "./espn";
import { geocode, kickoffWeather, milesBetween, tzOffsetHours } from "./places";
import { getProps } from "./props-feed";
import { assemble, type LiveBundle, type SourceStatus } from "./assemble";
import { addDays, DAY_TZ, dayKey } from "./day";
import { failureReason, fetchLog, pool } from "./http";
import { Registry, sameTeam, type Game } from "./registry";
import { actionNetwork } from "./sources/action-network";
import { mlbOfficial, nbaOfficial, nhlOfficial } from "./sources/official";
import { kalshi, polymarket } from "./sources/markets";
import { oddsApiLines } from "./sources/odds-api-lines";
import { cfbdSpPlus, footballData, lookup, mlbStandings, moneypuck, nflverse, seasonYear, type RatingTable } from "./ratings";
import { NflPlayers, normName, toNflverseAbbr, type NflStat } from "./players/nfl";
import { probOver } from "@/lib/engine/props";
import { slotOf } from "@/lib/nfl";
import { kalshiLadders } from "./sources/kalshi-ladders";
import { NflHistory } from "./nfl-history";
import { pausedTypes, qualifies } from "./policy";
import { updateHistory } from "./history";
import { tdDerby } from "./td-derby";
import { gameWhy, propContext } from "./why";
import { refreshTennisOdds, tennisGames, tennisPrediction } from "./sources/tennis";
import { impliedProb as implied, normCdf as normCdfLocal, normInv } from "@/lib/odds-math";

/** Hunter Sports Plus: everything but football (that's Hunter's Sauce). */
const DEFAULT_LEAGUES: LeagueId[] = ["NBA", "NHL", "MLB", "NCAAB", "EPL", "UCL", "LALIGA", "SERIEA", "BUNDESLIGA", "LIGUE1", "MLS", "WNBA", "ATP", "WTA"];
/** Sportsbook props (The Odds API credits): only these leagues, a few games a day, so one free key lasts the month. */
const PROP_LEAGUES = new Set<LeagueId>((process.env.PROP_LEAGUES ?? "NBA,MLB,NHL").split(",").map((x) => x.trim() as LeagueId));
/** Props are pulled once per game, for games kicking off within this many hours (the day before or game day). */
const PROP_WINDOW_H = Number(process.env.PROP_WINDOW_H ?? 36);
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD ?? 2);
const DAYS_BACK = 7;   // look back a week so rest days can come from the schedule
const PROP_GAMES = Number(process.env.PROP_GAMES ?? 4);
const LOG_WINDOW_MIN = Number(process.env.LOG_WINDOW_MIN ?? 70);
const hourSet = (v: string | undefined, d: string) => new Set((v || d).split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)));
const PROP_HOURS = hourSet(process.env.PROP_HOURS, "9");     // local hours (DAY_TZ) when props may load: once a day by default
const LINES_HOURS = hourSet(process.env.LINES_HOURS, "10,16"); // when The Odds API may backfill missing lines
const ymd = (k: string) => k.replace(/-/g, "");

export type PropResults = Record<string, { r: PickResult; start: string }>;

export async function buildLive(previousHistory: TrackedPick[], previousProps: PlayerProp[] = [], previousPropsAt?: string, previousCards: MatchupCardData[] = []): Promise<{ bundle: LiveBundle; history: TrackedPick[]; results: GameResults; propResults: PropResults }> {
  const now = new Date();
  const today = dayKey(now, DAY_TZ);
  const localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: DAY_TZ, hour: "numeric", hour12: false }).format(now)) % 24;
  const firstHalf = Number(new Intl.DateTimeFormat("en-US", { timeZone: DAY_TZ, minute: "numeric" }).format(now)) < 30;
  const forced = (process.env.FORCE_PROPS ?? "").toLowerCase() === "true";
  const raw = process.env.LEAGUES?.trim();
  const leagues = raw ? (raw.split(",").map((x) => x.trim().toUpperCase()) as LeagueId[]).filter((l) => LEAGUES[l]) : DEFAULT_LEAGUES;
  const start = addDays(today, -DAYS_BACK), end = addDays(today, DAYS_AHEAD);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const sources: SourceStatus[] = [];
  const notes: string[] = [];
  const note = (name: string, ok: boolean, detail: string) => sources.push({ name, ok, detail });
  const reg = new Registry();

  // ---- 1) games and prices from every free source ----
  const espnByGame = new Map<Game, EspnGame>();
  // tennis odds: a fresh pull at LINES_HOURS (or a forced run), cached between runs
  const tennisLeagues = leagues.filter((l) => LEAGUES[l].sport === "tennis");
  if (tennisLeagues.length && process.env.THE_ODDS_API_KEY && ((LINES_HOURS.has(localHour) && firstHalf) || forced)) {
    const n = await refreshTennisOdds(tennisLeagues);
    note("Tennis odds (The Odds API)", n !== null, n === null ? "no response" : `${n} matches priced`);
  }
  for (const lg of tennisLeagues) {
    const r = await tennisGames(reg, lg as "ATP" | "WTA", now);
    note(`${lg} matches`, !!r, r ? `${r.games} singles matches (ESPN), ${r.priced} with prices${r.oddsAt ? ` from ${new Date(r.oddsAt).toLocaleTimeString("en-US", { timeZone: DAY_TZ, hour: "numeric", minute: "2-digit" })}` : ""}` : "ESPN tennis didn't answer");
  }
  for (const lg of leagues.filter((l) => LEAGUES[l].sport !== "tennis")) {
    const parts: string[] = [];
    let anyOk = false;
    if (ESPN_PATHS[lg]) {
      // ESPN rejects long date ranges (HTTP 400), so ask a week at a time
      const chunks: [string, string][] = [[start, addDays(today, -1)], [today, end]];
      let list: EspnGame[] | null = null;
      for (const [a, b] of chunks) {
        const part = await getGames(lg, ymd(a), ymd(b));
        if (part) list = [...(list ?? []), ...part];
      }
      if (list) {
        anyOk = true;
        for (const eg of list) {
          const g = reg.upsert(eg.matchup, "ESPN", {
            espn: { eventId: eg.eventId, compId: eg.compId, homeTeamId: eg.homeTeamId, awayTeamId: eg.awayTeamId, homeAbbr: eg.homeAbbr, awayAbbr: eg.awayAbbr },
            homeLocation: eg.homeLocation, awayLocation: eg.awayLocation, venueCity: eg.venueCity, probables: eg.probables,
          });
          espnByGame.set(g, eg);
        }
        parts.push(`ESPN ${list.length}${espnVariant.used && espnVariant.used !== "range" ? ` via ${espnVariant.used}` : ""}`);
      } else parts.push(`ESPN ${failureReason("https://site.api.espn.com")}`);
    }
    const an = await actionNetwork(reg, lg, days.filter((d) => d >= addDays(today, -1)));
    if (an.games) { anyOk = true; parts.push(`Action Network ${an.games}`); } else if (an.failed) parts.push(`Action Network ${failureReason("https://api.actionnetwork.com")}`);
    if (lg === "MLB") { const n = await mlbOfficial(reg, start, end); if (n !== null) { anyOk = true; parts.push(`MLB.com ${n}`); } }
    if (lg === "NHL") { const n = await nhlOfficial(reg, days); if (n !== null) { anyOk = true; parts.push(`NHL.com ${n}`); } }
    if (lg === "NBA") { const n = await nbaOfficial(reg, start, end); if (n !== null) { anyOk = true; parts.push(`NBA.com ${n}`); } }
    const games = reg.games.filter((g) => g.matchup.league === lg).length;
    if (games || !anyOk) note(`${lg} games`, games > 0 || anyOk, games ? `${games} games (${parts.join(", ")})` : parts.join(", ") || "no source answered");
  }

  // ESPN sportsbook lines for ESPN-known upcoming games
  const upcoming = reg.games.filter((g) => g.matchup.status === "scheduled" && new Date(g.matchup.startTime) > now);
  await pool(upcoming.filter((g) => espnByGame.has(g)), 6, async (g) => {
    const eg = espnByGame.get(g)!;
    for (const o of await getOdds(g.matchup.league, eg, LEAGUES[g.matchup.league].hasDraw))
      for (const q of o.quotes) reg.addQuote(g, o.market, o.side, q.americanOdds, o.line, q.bookmaker.name);
  });

  // prediction markets
  for (const lg of leagues.filter((l) => LEAGUES[l].sport !== "tennis")) {
    const k = await kalshi(reg, lg), p = await polymarket(reg, lg);
    if (k) note(`Kalshi ${lg}`, true, `${k} prices`);
    if (p) note(`Polymarket ${lg}`, true, `${p} prices`);
  }

  // The Odds API backfill for leagues still missing lines (costs credits, so only when needed and at set hours)
  if (process.env.THE_ODDS_API_KEY && LINES_HOURS.has(localHour) && firstHalf) {
    for (const lg of leagues.filter((l) => LEAGUES[l].sport !== "tennis")) {
      const soon = upcoming.filter((g) => g.matchup.league === lg && new Date(g.matchup.startTime).getTime() - now.getTime() < 48 * 3600_000);
      const missing = soon.filter((g) => ![...g.outcomes.values()].some((o) => o.market === "moneyline"));
      if (missing.length && missing.length >= soon.length / 2) {
        const n = await oddsApiLines(reg, lg);
        note(`The Odds API lines ${lg}`, n !== null && n > 0, n === null ? "no response" : `${n} games backfilled`);
      }
    }
  }
  // games this week that already started but never made it onto the board (e.g. the site was updated after kickoff):
  // rebuild them from ESPN with closing lines so they still show, with their live/final score
  // daily sports: started games stay up (with scores) for about a day
  const weekStart = new Date(now.getTime() - 20 * 3600_000);
  const prevIds = new Set(previousCards.map((c) => c.matchup.id));
  const rebuild = reg.games.filter((g) => (g.matchup.status === "live" || g.matchup.status === "final")
    && new Date(g.matchup.startTime) >= weekStart && !prevIds.has(g.matchup.id) && espnByGame.has(g));
  await pool(rebuild, 4, async (g) => {
    for (const o of await getOdds(g.matchup.league, espnByGame.get(g)!, false, true))
      for (const q of o.quotes) reg.addQuote(g, o.market, o.side, q.americanOdds, o.line, q.bookmaker.name);
  });
  if (rebuild.length) note("Started games rebuilt", true, `${rebuild.filter((g) => g.outcomes.size).length} of ${rebuild.length} from ESPN closing lines`);
  const priced = [...upcoming.filter((g) => g.outcomes.size > 0), ...rebuild.filter((g) => g.outcomes.size > 0)];
  note("Sportsbook lines", priced.length > 0, `${priced.length} of ${upcoming.length} upcoming games priced (${new Set(priced.flatMap((g) => [...g.outcomes.values()].flatMap((o) => o.quotes.map((q) => q.bookmaker.name)))).size} books)`);

  // ---- 2) team strength ----
  const tables: Partial<Record<LeagueId, RatingTable | null>> = {};
  const want = new Set(priced.map((g) => g.matchup.league));
  if (want.has("NFL")) tables.NFL = await nflverse(now);
  if (want.has("NHL")) tables.NHL = await moneypuck(now);
  if (want.has("MLB")) tables.MLB = await mlbStandings(now);
  if (want.has("NCAAF")) tables.NCAAF = await cfbdSpPlus(now);
  if (want.has("EPL")) tables.EPL = await footballData("PL");
  if (want.has("UCL")) tables.UCL = await footballData("CL");
  for (const [lg, t] of Object.entries(tables)) note(`${lg} ratings`, !!t, t ? t.source : "fell back to season scoring");
  if (want.has("NCAAF") && !process.env.CFBD_API_KEY) notes.push("Add a free CFBD_API_KEY (collegefootballdata.com) for SP+ college ratings.");
  if ((want.has("EPL") || want.has("UCL")) && !process.env.FOOTBALL_DATA_KEY) notes.push("Add a free FOOTBALL_DATA_KEY (football-data.org) for better soccer ratings.");

  // ---- 3) situation + engine, per priced game ----
  const cards: MatchupCardData[] = [];
  const bets: ValueBet[] = [];
  let withInjuries = 0;
  const skipped: string[] = [];
  const predicted: { g: Game; m: Game["matchup"]; pred: ReturnType<typeof predict>; factors: MatchupFactors }[] = [];
  const paused = pausedTypes(previousHistory);
  for (const t of paused) notes.push(`Paused: ${t} picks. They've been losing to the closing line, so the board won't recommend them until that recovers.`);
  await pool(priced, 6, async (g) => {
    const m = g.matchup;
    const league = LEAGUES[m.league];
    if (league.sport === "tennis") {
      const none = { ratings: { powerRating: 0, sampleSize: 1 }, injuries: [], rest: { daysRest: 1, backToBack: false, gamesLast7: 0 } };
      predicted.push({ g, m, pred: tennisPrediction(m, now), factors: { matchupId: m.id, home: none, away: none } });
      return;
    }
    const P = paramsFor(m.league);
    const eg = espnByGame.get(g);
    const ratingFor = async (side: "home" | "away"): Promise<TeamRatings> => {
      const t = side === "home" ? m.home : m.away;
      const adv = lookup(tables[m.league] ?? null, t.name, t.abbreviation);
      if (adv) return adv;
      const teamId = side === "home" ? g.espn?.homeTeamId : g.espn?.awayTeamId;
      return (teamId && (await getTeamRatings(m.league, teamId, P.avgTotal))) || { powerRating: 0, sampleSize: 0 };
    };
    const [summary, rh, ra, venuePlace, awayPlace] = await Promise.all([
      eg ? getSummary(m.league, league.sport, eg).catch(() => null) : Promise.resolve(null),
      ratingFor("home"), ratingFor("away"),
      geocode(g.venueCity || m.venue?.city || g.homeLocation || cityOf(m.home.name)),
      geocode(g.awayLocation || cityOf(m.away.name)),
    ]);
    if (!rh.sampleSize || !ra.sampleSize) {
      // no strength data for a team (new leagues, small schools): picks come from the market anyway, so price the game
      // with a market-only projection and show no model lean
      skipped.push(`${m.away.shortName} @ ${m.home.shortName}`);
      const empty = { ratings: { powerRating: 0, sampleSize: 0 }, injuries: [], rest: { daysRest: 7, backToBack: false, gamesLast7: 0 } };
      predicted.push({ g, m, pred: marketPrediction(g), factors: { matchupId: m.id, home: empty, away: empty } });
      return;
    }
    if (summary && (summary.injuries.home.length || summary.injuries.away.length)) withInjuries++;
    const startT = new Date(m.startTime);
    const lastFromSchedule = (name: string) => reg.games
      .filter((x) => x !== g && x.matchup.league === m.league && new Date(x.matchup.startTime) < startT && (sameTeam(x.matchup.home.name, name) || sameTeam(x.matchup.away.name, name)))
      .map((x) => x.matchup.startTime).sort().pop();
    const restDays = (iso?: string) => (iso ? Math.max(0, Math.round((startT.getTime() - new Date(iso).getTime()) / 86_400_000)) : 7);
    const hRest = restDays(summary?.lastGame.home ?? lastFromSchedule(m.home.name));
    const aRest = restDays(summary?.lastGame.away ?? lastFromSchedule(m.away.name));
    let tz = 0, miles: number | undefined;
    if (venuePlace && awayPlace && !m.neutralSite) {
      tz = Math.abs(tzOffsetHours(venuePlace.tz, startT) - tzOffsetHours(awayPlace.tz, startT));
      miles = milesBetween(venuePlace, awayPlace);
    }
    const outdoor = !m.venue?.indoor && ["football", "baseball", "soccer"].includes(league.sport);
    const weather = outdoor && venuePlace ? await kickoffWeather(venuePlace, m.startTime) : undefined;

    const factors: MatchupFactors = {
      matchupId: m.id,
      home: { ratings: rh, injuries: summary?.injuries.home ?? [], rest: { daysRest: hRest, backToBack: hRest <= 1, gamesLast7: 0 } },
      away: { ratings: ra, injuries: summary?.injuries.away ?? [], rest: { daysRest: aRest, backToBack: aRest <= 1, gamesLast7: 0, timezonesCrossed: tz || undefined, travelMiles: miles } },
      weather,
      keyStarters: g.probables?.home || g.probables?.away ? {
        home: g.probables?.home?.name, away: g.probables?.away?.name,
        note: g.probables?.home && g.probables?.away ? `Probable starters: ${g.probables.away.name} vs ${g.probables.home.name}` : undefined,
      } : undefined,
    };
    const pred = predict(factors, m.league, { neutralSite: m.neutralSite, indoor: m.venue?.indoor });
    predicted.push({ g, m, pred, factors });
  });

  // ---- 3a) calibration: catch league-wide bias before pricing ----
  // If the model's totals (or margins) sit systematically above or below the market across a whole league's slate,
  // that's a calibration problem, not 20 separate edges (a wall of Unders is the classic symptom). Remove most of
  // the league-wide offset; the game-to-game differences still come from the model.
  for (const lg of [...new Set(predicted.map((x) => x.m.league))]) {
    const rows = predicted.filter((x) => x.m.league === lg);
    const P = paramsFor(lg);
    const totalGaps = rows.map((x) => { const t = mainLine(x.g, "total", "over"); return t === undefined ? null : x.pred.projectedTotal - t; }).filter((v): v is number => v !== null);
    const marginGaps = rows.map((x) => { const mm = marketMargin(x.g); return mm === undefined ? null : x.pred.projectedMargin - mm; }).filter((v): v is number => v !== null);
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    if (totalGaps.length >= 4) {
      const shift = -0.8 * avg(totalGaps);
      if (Math.abs(shift) >= 0.05 * P.totalSd) {
        for (const x of rows) {
          x.pred.projectedTotal = Math.max(0.5, x.pred.projectedTotal + shift);
          x.pred.projectedScore = { home: x.pred.projectedScore.home + shift / 2, away: x.pred.projectedScore.away + shift / 2 };
          x.pred.triggers.push({ category: "ratings", label: "League calibration", detail: `Model totals ran ${shift < 0 ? "high" : "low"} across ${totalGaps.length} ${lg} games today, so ${Math.abs(shift).toFixed(1)} was ${shift < 0 ? "removed" : "added"}`, marginImpact: 0, totalImpact: shift, severity: "low" });
        }
        notes.push(`${lg} totals recalibrated by ${shift > 0 ? "+" : ""}${shift.toFixed(1)}: the model was ${shift < 0 ? "high" : "low"} vs the market across the whole slate.`);
      }
    }
    if (marginGaps.length >= 4 && !LEAGUES[lg].hasDraw) {
      const shift = -0.8 * avg(marginGaps);
      if (Math.abs(shift) >= 0.05 * P.marginSd) {
        for (const x of rows) {
          x.pred.projectedMargin += shift;
          x.pred.projectedScore = { home: x.pred.projectedScore.home + shift / 2, away: x.pred.projectedScore.away - shift / 2 };
          x.pred.homeWinProb = Math.min(0.99, Math.max(0.01, normCdfLocal(x.pred.projectedMargin / P.marginSd)));
          x.pred.awayWinProb = 1 - x.pred.homeWinProb;
          x.pred.triggers.push({ category: "ratings", label: "League calibration", detail: `Model leaned ${shift < 0 ? "home" : "away"} across ${marginGaps.length} ${lg} games today; ${Math.abs(shift).toFixed(1)} adjusted`, marginImpact: shift, severity: "low" });
        }
        notes.push(`${lg} margins recalibrated by ${shift > 0 ? "+" : ""}${shift.toFixed(1)} (home side) vs the market's slate-wide lean.`);
      }
    }
  }

  // ---- 3b) price every game ----
  // Every outcome is anchored to the sportsbooks' no-vig price; one with no two-sided sportsbook market is skipped.
  let unanchored = 0;
  for (const { g, m, pred, factors } of predicted) {
    const why = pred.triggers.filter((t) => t.category !== "venue" && t.label !== "League calibration").slice(0, 2).map((t) => t.label.toLowerCase()).join(", ");
    const pricedBets = [...g.outcomes.values()]
      .map((o) => {
        const anchor = marketAnchor(g, o);
        if (!anchor) { unanchored++; return null; }
        return toValueBet(o, pred, m.league, why ? `biggest factors: ${why}` : "", anchor);
      })
      .filter((b): b is ValueBet => b !== null);
    if (!pricedBets.length) continue;
    // headline pick: best qualifying edge, else a positive one (shown with its warning), else the best available
    const tierOfPick = (b: ValueBet) => (qualifies(b, m.league, paused) ? 0 : b.edge > 0 && !b.flags?.includes("large_gap") ? 1 : b.edge > 0 ? 2 : 3);
    const recommended = [...pricedBets].sort((a, b) => tierOfPick(a) - tierOfPick(b) || b.edge - a.edge)[0];
    cards.push({ matchup: m, prediction: pred, factors, recommended, otherBets: pricedBets.filter((b) => b.id !== recommended.id),
      marketLine: { margin: marketMargin(g), total: mainLine(g, "total", "over") } });
    bets.push(...pricedBets);
  }
  if (unanchored) notes.push(`${unanchored} prices skipped: no two-sided sportsbook market to check them against (exchange-only or one-sided quotes).`);
  note("Injuries (ESPN)", withInjuries > 0 || cards.length === 0, `${withInjuries} games with injury reports`);
  if (skipped.length) notes.push(`${skipped.length} games have no team-strength data (e.g. ${skipped.slice(0, 3).join(", ")}), so they show the market only, with no model lean.`);
  note("Weather (Open-Meteo)", true, `${cards.filter((c) => c.factors.weather).length} outdoor forecasts`);

  // ---- 3b) Kalshi ladders: alt spreads/totals for every league, player props for NFL (free, every run) ----
  // per team: players listed Out or Doubtful (their usage gets redistributed to teammates; they get no projection)
  const outByTeam = new Map<string, Set<string>>();
  for (const c of cards) for (const side of ["home", "away"] as const)
    outByTeam.set(`${c.matchup.id}:${side}`, new Set(c.factors[side].injuries.filter((i) => i.status === "out" || i.status === "doubtful").map((i) => normName(i.playerName))));
  const nflPlayers = cards.some((c) => c.matchup.league === "NFL") ? await NflPlayers.load(seasonYear(now, true)) : null;
  const nflHistory = cards.some((c) => c.matchup.league === "NFL") ? await NflHistory.load() : null;
  if (nflHistory) for (const c of cards) c.teasers = teaserLegs(c, nflHistory);
  if (cards.some((c) => c.matchup.league === "NFL")) note("NFL line history", !!nflHistory, nflHistory ? "real results vs. the line since 2010 (for alt spreads/totals)" : "couldn't load; using the bell curve");
  if (cards.some((c) => c.matchup.league === "NFL")) note("NFL player projections", !!nflPlayers, nflPlayers ? "nflverse weekly player stats" : "couldn't load player stats");
  const kalshiProps: PlayerProp[] = [];
  for (const lg of [...new Set(cards.map((c) => c.matchup.league))].filter((l) => LEAGUES[l].sport !== "tennis")) {
    const lc = cards.filter((c) => c.matchup.league === lg);
    const res = await kalshiLadders(lg, lc, lg === "NFL" ? nflPlayers : null, outByTeam, lg === "NFL" ? nflHistory : null).catch(() => null);
    if (!res) continue;
    for (const c of lc) { const l = res.ladders.get(c.matchup.id); if (l?.length) c.altLadders = l; }
    kalshiProps.push(...res.props);
    for (const d of res.diag) note(d.name, d.ok, d.detail);
  }

  // reasons behind every player projection, by "<matchupId>|<player>|<stat>" (the TD derby fills in touchdowns)
  const propWhy: Record<string, WhyPart[]> = {};
  const derby = tdDerby(cards, nflPlayers, kalshiProps, outByTeam, propWhy);
  if (nflPlayers) note("TD derby", derby.length > 0, `${derby.length} players ranked`);

  // ---- 3c) this week's games that have started stay on the site (frozen at their last pregame prices, with the live
  // or final score) until the NFL week ends, so their bets can show how they did
  let keptGames = 0;
  for (const pc of previousCards) {
    if (cards.some((c) => c.matchup.id === pc.matchup.id) || new Date(pc.matchup.startTime) < weekStart) continue;
    const g = reg.games.find((x) => x.matchup.id === pc.matchup.id);
    const st = g?.matchup.status;
    if (!g || st === "postponed" || (st === "scheduled" && new Date(g.matchup.startTime) > now)) continue;
    pc.matchup.status = st === "scheduled" ? "live" : st!;
    pc.matchup.score = g.matchup.score ?? pc.matchup.score;
    cards.push(pc);
    keptGames++;
  }
  if (keptGames) note("Started games kept", true, `${keptGames} games this week shown with scores`);

  // ---- 4) props: each game once, in the window before kickoff, to fit the free 500 credits ----
  // Games already pulled keep their props until kickoff (and after, for results); "Load props now" refreshes the window.
  const openIds = new Set(cards.filter((c) => c.matchup.status === "scheduled").map((c) => c.matchup.id));
  const allIds = new Set(cards.map((c) => c.matchup.id));
  const carried = previousProps.filter((p) => allIds.has(p.matchupId) && p.source !== "kalshi");   // Kalshi props refresh every run
  const pulledIds = new Set(carried.map((p) => p.matchupId));
  let props: PlayerProp[] = [];
  let propsLoadedAt = previousPropsAt;
  let pulledProps = false;
  const fresh = new Set<string>();
  if (process.env.THE_ODDS_API_KEY && (forced || (PROP_HOURS.has(localHour) && firstHalf))) {
    const windowEnd = now.getTime() + PROP_WINDOW_H * 3600_000;
    // sportsbook props: a few NBA/MLB/NHL games a day (credits)
    const soon = cards.filter((c) => PROP_LEAGUES.has(c.matchup.league) && openIds.has(c.matchup.id) && new Date(c.matchup.startTime).getTime() <= windowEnd && (forced || !pulledIds.has(c.matchup.id)))
      .sort((a, b) => a.matchup.startTime.localeCompare(b.matchup.startTime)).slice(0, PROP_GAMES);
    let loaded = 0;
    for (const c of soon) {
      const g = reg.games.find((x) => x.matchup.id === c.matchup.id)!;
      const [homeRoster, awayRoster] = g.espn
        ? await Promise.all([getRosterNames(c.matchup.league, g.espn.homeTeamId), getRosterNames(c.matchup.league, g.espn.awayTeamId)])
        : [[], []];
      const avgPts = paramsFor(c.matchup.league).avgTotal / 2;
      const rp = await getProps(c.matchup.league, {
        matchupId: c.matchup.id, home: c.matchup.home.name, away: c.matchup.away.name,
        homeAvgPts: (c.factors.home.ratings.offense ?? 0) + avgPts, awayAvgPts: (c.factors.away.ratings.offense ?? 0) + avgPts, homeRoster, awayRoster,
      }, c.prediction, c.prediction.confidenceTier, PRIMETIME.has(slotOf(c.matchup.startTime).key));
      if (rp) { props.push(...rp); loaded++; fresh.add(c.matchup.id); }
    }
    if (soon.length) note("Player props (The Odds API)", loaded > 0,
      loaded ? `${props.length} props from ${loaded} games` : `no props: ${failureReason("https://api.the-odds-api.com")}`);
    if (props.length) { pulledProps = true; propsLoadedAt = now.toISOString(); }
  } else if (!process.env.THE_ODDS_API_KEY) notes.push("Player props are off: add a THE_ODDS_API_KEY secret to turn them on.");

  // games pulled earlier keep their props until kickoff
  const kept = carried.filter((p) => !fresh.has(p.matchupId));
  if (kept.length) { props.push(...kept); note("Player props (carried over)", true, `${kept.length} props for ${new Set(kept.map((p) => p.matchupId)).size} games from earlier pulls`); }
  if (!pulledProps && !kept.length && process.env.THE_ODDS_API_KEY) notes.push(`Player props load at 9 AM Central for games in the next ${PROP_WINDOW_H} hours.`);

  // ---- 5) transparency log ----
  // build the board once, log what it recommends, then rebuild with the updated record
  // our chance for every sportsbook prop, from our player projections; Kalshi rungs already carry it
  if (nflPlayers) {
    let withOurs = 0;
    for (const p of props) {
      const c = cards.find((x) => x.matchup.id === p.matchupId);
      const r = c ? ourPropChance(p, c, nflPlayers, outByTeam) : null;
      if (r) { p.ourProb = r.prob; p.why = r.why; withOurs++; }
    }
    if (props.length) note("Our prop projections", withOurs > 0, `${withOurs} of ${props.length} sportsbook props have our chance`);
  }
  // same bar as sportsbook props: "high" confidence means 3+ games of data behind the projection
  for (const p of kalshiProps) if (p.confidence === "high" && ourChanceSane(p.modelProb, p)) { p.ourProb = p.modelProb; p.why = p.matchupNote; }
  // thousands of Kalshi rungs: keep the playable ones (a couple per player and stat) so the data stays phone-sized
  props = [...props, ...trimRungs(kalshiProps)];
  // the "Why?" lists: every game's factors, and every player projection behind a prop
  const units = nflPlayers?.teamUnits() ?? null;
  for (const c of cards) c.why = gameWhy(c, c.matchup.league === "NFL" ? units : null);
  if (nflPlayers) for (const p of props) {
    const key = `${p.matchupId}|${p.playerName}|${p.stat}`;
    if (propWhy[key]) continue;
    const c = cards.find((x) => x.matchup.id === p.matchupId);
    const r = c ? projectFor(p.playerName, p.stat, c, nflPlayers, outByTeam) : null;
    if (r) propWhy[key] = [...r.proj.parts, ...propContext(c!, r.isHome, p.stat)];
  }
  const prelim = assemble({ tdDerby: derby, cards, bets, props, history: previousHistory, generatedAt: now.toISOString(), isMock: false, tz: DAY_TZ, paused });
  const history = await updateHistory(previousHistory, prelim, cards, reg.games, now, nflPlayers);
  if (fetchLog.length) notes.push(`${fetchLog.length} requests failed this run (status: ${[...new Set(fetchLog.map((f) => String(f.status)))].slice(0, 4).join(", ")}). Other sources filled in where they could.`);
  if (!cards.length) notes.push("No priced games this run. The board will show the last good data if there is any.");

  const bundle = assemble({ tdDerby: derby, paused, cards, bets, props, history, generatedAt: now.toISOString(), isMock: false, tz: DAY_TZ, status: { sources, notes }, propsLoadedAt });
  const shownKeys = new Set([...bundle.byDay.all.props.map((p) => `${p.matchupId}|${p.playerName}|${p.stat}`), ...(bundle.byDay.all.tdDerby ?? []).map((t) => `${t.matchupId}|${t.player}|anytime_td`)]);
  bundle.propWhy = Object.fromEntries(Object.entries(propWhy).filter(([k]) => shownKeys.has(k)));
  // final scores from the last week, so the browser can settle any tracked bet or parlay leg itself
  const results: GameResults = {};
  for (const g of reg.games) if (g.matchup.status === "final" && g.matchup.score)
    results[g.matchup.id] = { home: g.matchup.score.home, away: g.matchup.score.away, homeTeam: g.matchup.home.name, awayTeam: g.matchup.away.name, start: g.matchup.startTime };
  // prop results for finished games (official player stats, usually posted the morning after), so tracked props settle
  const propResults: PropResults = {};
  if (nflPlayers) for (const c of cards) {
    if (c.matchup.status !== "final") continue;
    const teams = [toNflverseAbbr(c.matchup.home.abbreviation), toNflverseAbbr(c.matchup.away.abbreviation)];
    const posted = nflPlayers.gamePosted(teams, c.matchup.week);
    for (const p of props) {
      if (p.matchupId !== c.matchup.id) continue;
      const v = nflPlayers.actual(p.playerName, p.stat, teams, c.matchup.week);
      // stats are in but he has none: didn't play, so the bet is voided (stake back, shown as a push)
      if (v === null) { if (posted) propResults[p.id] = { r: "push", start: c.matchup.startTime }; continue; }
      const d = p.side === "over" ? v - p.line : p.line - v;
      propResults[p.id] = { r: d > 0 ? "win" : d < 0 ? "loss" : "push", start: c.matchup.startTime };
    }
    // TD Derby picks (id td:<game>:<Player_Name>) settle from the same official stats
    for (const side of ["home", "away"] as const) {
      const team = toNflverseAbbr(c.matchup[side].abbreviation);
      if (!team) continue;
      for (const cand of nflPlayers.candidates(team)) {
        const v = nflPlayers.actual(cand.name, "anytime_td", teams, c.matchup.week);
        const id = `td:${c.matchup.id}:${cand.name}`.replace(/\s+/g, "_");
        if (v !== null) propResults[id] = { r: v >= 1 ? "win" : "loss", start: c.matchup.startTime };
        else if (posted) propResults[id] = { r: "push", start: c.matchup.startTime };
      }
    }
  }
  return { bundle, history, results, propResults };
}

/** Start of the current NFL week: Tuesday ~6 AM Eastern (10:00 UTC). */
function nflWeekStart(now: Date): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 2 + 7) % 7));
  d.setUTCHours(10, 0, 0, 0);
  if (d > now) d.setUTCDate(d.getUTCDate() - 7);
  return d;
}

/** Team names start with the city for pro teams ("Kansas City Chiefs" -> "Kansas City"). */
function cityOf(name: string): string {
  const w = name.split(" ");
  return w.length > 2 && ["Sox", "Jays", "Leafs", "Wings", "Knights", "Blazers"].includes(w[w.length - 1]) ? w.slice(0, -2).join(" ") : w.slice(0, -1).join(" ");
}

/** Leagues where the "spread" is a fixed run/puck line (always 1.5), so it says nothing about the expected margin. */
const FIXED_LINE_LEAGUES = new Set(["NHL", "MLB"]);

/**
 * The sportsbooks' expected home margin. Point sports: minus the main spread. NHL/MLB: from the no-vig moneyline
 * (median across books), turned into a margin with the league's outcome spread. Soccer: not used (draws).
 */
function marketMargin(g: Game): number | undefined {
  const lg = g.matchup.league;
  if (LEAGUES[lg].hasDraw) return undefined;
  if (!FIXED_LINE_LEAGUES.has(lg)) { const l = mainLine(g, "spread", "home"); return l === undefined ? undefined : -l; }
  const home = [...g.outcomes.values()].find((o) => o.market === "moneyline" && o.side === "home");
  const away = [...g.outcomes.values()].find((o) => o.market === "moneyline" && o.side === "away");
  if (!home || !away) return undefined;
  const probs: number[] = [];
  for (const q of home.quotes) {
    const a = away.quotes.find((x) => x.bookmaker.key === q.bookmaker.key);
    if (!a || q.bookmaker.key === "kalshi" || q.bookmaker.key === "polymarket") continue;
    const ph = implied(q.americanOdds), pa = implied(a.americanOdds);
    probs.push(ph / (ph + pa));
  }
  if (!probs.length) return undefined;
  probs.sort((x, y) => x - y);
  const p = probs[Math.floor(probs.length / 2)];
  return paramsFor(lg).marginSd * normInv(p);
}

/** Prediction markets: fine to bet, but too thin and stale to define the fair price. */
const EXCHANGES = new Set(["kalshi", "polymarket"]);
/**
 * A quote paying this far above the consensus fair price is stale or mis-scraped, not value. Real mispricings at US
 * books are usually 1-3 points; at 5 points the board was full of lines that had already moved.
 */
const OUTLIER_PTS = 0.03;
/** Polymarket lists mid prices, not prices you can buy at, so it can inform nothing and can't be the best price. */
const NOT_BETTABLE = new Set(["polymarket"]);

/**
 * The sportsbooks' no-vig chance for one outcome (median across books that quote every side at the same line) and
 * the best quote that isn't an outlier against it.
 */
function marketAnchor(g: Game, o: MarketOutcome): { fairProb: number; best: OddsQuote; books: number } | undefined {
  const opp = [...g.outcomes.values()].filter((x) => x.market === o.market && x.side !== o.side
    && (o.market === "moneyline" || (o.market === "spread" ? x.line === -(o.line ?? NaN) : x.line === o.line)));
  if (!opp.length) return undefined;
  const fair: number[] = [];
  for (const q of o.quotes) {
    if (EXCHANGES.has(q.bookmaker.key)) continue;
    const others = opp.map((x) => x.quotes.find((y) => y.bookmaker.key === q.bookmaker.key));
    if (others.some((y) => !y)) continue;
    const mine = implied(q.americanOdds);
    const book = mine + others.reduce((s, y) => s + implied(y!.americanOdds), 0);
    if (book < 1 || book > 1.15) continue;   // not a coherent market from this book
    fair.push(mine / book);
  }
  if (!fair.length) return undefined;
  fair.sort((a, b) => a - b);
  const fairProb = fair.length % 2 ? fair[(fair.length - 1) / 2] : (fair[fair.length / 2 - 1] + fair[fair.length / 2]) / 2;
  const ok = o.quotes.filter((q) => !NOT_BETTABLE.has(q.bookmaker.key) && implied(q.americanOdds) >= fairProb - OUTLIER_PTS);
  if (!ok.length) return undefined;
  return { fairProb, best: ok.reduce((a, b) => (implied(b.americanOdds) < implied(a.americanOdds) ? b : a)), books: fair.length };
}

/**
 * A projection 25+ points away from the price almost always means news it missed (a QB change, a role change), not a
 * gift; showing it would invite exactly the bets that sank the old model, so no number is shown.
 */
const ourChanceSane = (prob: number, p: PlayerProp) => Math.abs(prob - p.impliedProb) <= 0.25;

/** Primetime windows get alt prop ladders from the sportsbooks (they cost extra credits). */
const PRIMETIME = new Set(["thu", "snf", "mnf"]);

/** One player's projection for a stat in this game (form, opponent, script, injured teammates), as the props use it. */
function projectFor(name: string, statName: string, c: MatchupCardData, players: NflPlayers, outByTeam: Map<string, Set<string>>) {
  if (!["passing_yards", "rushing_yards", "receiving_yards", "receptions", "passing_tds"].includes(statName)) return null;
  const team = players.teamOf(name);
  const home = toNflverseAbbr(c.matchup.home.abbreviation), away = toNflverseAbbr(c.matchup.away.abbreviation);
  if (!team || (team !== home && team !== away)) return null;
  const isHome = team === home;
  const teamPts = isHome ? c.prediction.projectedScore.home : c.prediction.projectedScore.away;
  const usual = 22 + ((isHome ? c.factors.home : c.factors.away).ratings.offense ?? 0);
  const script = usual > 0 ? 1 + 0.25 * (teamPts / usual - 1) : 1;
  const out = outByTeam.get(`${c.matchup.id}:${isHome ? "home" : "away"}`) ?? new Set<string>();
  if (out.has(normName(name))) return null;
  const stat = statName as NflStat;
  const proj = players.project(name, stat, isHome ? away : home, script, 0.06, players.usageBoost(name, team, out, stat));
  return proj ? { proj, isHome } : null;
}

/** Our chance for a sportsbook prop: the same player projection the Kalshi rungs use (form, opponent, script, injuries). */
function ourPropChance(p: PlayerProp, c: MatchupCardData, players: NflPlayers, outByTeam: Map<string, Set<string>>): { prob: number; why: string } | null {
  const proj = projectFor(p.playerName, p.stat, c, players, outByTeam)?.proj;
  // fewer than 3 games of data (a backup suddenly starting, a rookie) means the projection is a guess: no number
  if (!proj || proj.games < 3) return null;
  const pOver = probOver(proj, p.line);
  const prob = p.side === "over" ? pOver : 1 - pOver;
  if (!ourChanceSane(prob, p)) return null;
  return { prob, why: `Projects ${proj.mean.toFixed(1)}. ${proj.note}`.trim() };
}

/**
 * Kalshi prop rungs worth showing: -250 to +400, either likely (our chance 50%+) or a longshot we like (25%+ and 3+ points
 * over the price), best two per player and stat by how much we like them over the price.
 */
function trimRungs(rungs: PlayerProp[]): PlayerProp[] {
  // Kalshi can list the same bet in two series (e.g. anytime TD and a "protected" TD market): one copy, best price
  const best = new Map<string, PlayerProp>();
  for (const p of rungs) { const ex = best.get(p.id); if (!ex || p.bestQuote.americanOdds > ex.bestQuote.americanOdds) best.set(p.id, p); }
  const keep = [...best.values()].filter((p) => {
    if (p.ourProb === undefined) return false;
    const o = p.bestQuote.americanOdds, our = p.ourProb;
    if (p.flags?.includes("large_gap") || o < -250 || o > 400) return false;
    return o <= 120 ? our >= 0.5 : our >= 0.25 && our - p.impliedProb >= 0.03;
  });
  const groups = new Map<string, PlayerProp[]>();
  for (const p of keep) { const k = `${p.matchupId}|${p.playerName}|${p.stat}`; groups.set(k, [...(groups.get(k) ?? []), p]); }
  return [...groups.values()].flatMap((g) => g.sort((a, b) => ((b.ourProb ?? 0) - b.impliedProb) - ((a.ourProb ?? 0) - a.impliedProb)).slice(0, 2));
}

/**
 * 6-point teaser legs: tease each side's main spread by 6 and look up how often similar games (by the market's
 * expected margin) actually covered that line since 2010. A 2-team teaser at -120 needs about 73.9% per leg.
 */
function teaserLegs(c: MatchupCardData, h: NflHistory): TeaserLeg[] {
  const mm = c.marketLine?.margin;   // expected home margin = minus the home spread
  if (c.matchup.league !== "NFL" || mm === undefined) return [];
  const out: TeaserLeg[] = [];
  for (const side of ["home", "away"] as const) {
    const line = side === "home" ? -mm : mm;   // this side's spread
    const teased = line + 6;
    // margins are whole numbers (home minus away). Home covers when margin > -teased; away covers when margin < teased,
    // i.e. not (margin >= teased) = not (margin > ceil(teased) - 1). A push never counts as a win.
    const p = side === "home" ? h.pMarginOver(mm, -teased) : (() => { const q = h.pMarginOver(mm, Math.ceil(teased) - 1); return q === null ? null : 1 - q; })();
    if (p === null) continue;
    const wong = (line >= -8.5 && line <= -7.5) || (line >= 1.5 && line <= 2.5);
    out.push({ side, team: c.matchup[side].shortName, line, teased, prob: p, wong });
  }
  return out;
}

/**
 * A projection built from the market alone, for games with no team-strength data: win chance from the consensus
 * moneyline, margin from the main spread (or the moneyline), total from the main total.
 */
function marketPrediction(g: Game): Prediction {
  const m = g.matchup;
  const P = paramsFor(m.league);
  const ml = (side: "home" | "away" | "draw") => [...g.outcomes.values()].find((o) => o.market === "moneyline" && o.side === side);
  const h = ml("home"), d = ml("draw");
  const homeWinProb = (h ? marketAnchor(g, h)?.fairProb : undefined) ?? 0.5;
  const drawFair = d ? marketAnchor(g, d)?.fairProb : undefined;
  const margin = marketMargin(g) ?? P.marginSd * normInv(Math.min(0.99, Math.max(0.01, homeWinProb)));
  const total = mainLine(g, "total", "over") ?? P.avgTotal;
  return {
    matchupId: m.id, generatedAt: new Date().toISOString(), modelVersion: "market",
    homeWinProb, awayWinProb: 1 - homeWinProb - (drawFair ?? 0), drawProb: drawFair,
    projectedScore: { home: total / 2 + margin / 2, away: total / 2 - margin / 2 }, projectedMargin: margin, projectedTotal: total,
    confidence: 0.5, confidenceTier: "medium",
    triggers: [{ category: "ratings", label: "Market consensus", detail: "No team-strength data for this game, so this is the sportsbooks' consensus", marginImpact: 0, severity: "low" }],
  };
}

/** The market's main line for a game: the spread/total line the most books are quoting. */
function mainLine(g: Game, market: "spread" | "total", side: "home" | "over"): number | undefined {
  let best: { line: number; n: number } | undefined;
  for (const o of g.outcomes.values()) {
    if (o.market !== market || o.side !== side || o.line === undefined) continue;
    if (!best || o.quotes.length > best.n) best = { line: o.line, n: o.quotes.length };
  }
  return best?.line;
}
