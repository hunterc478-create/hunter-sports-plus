/**
 * Mock data for the dashboard.
 *
 * Nothing here is hard-coded output: mock *inputs* (team factors and market prices) are run through the
 * same engine the live pipeline uses, so every probability, edge, EV and parlay price is internally consistent.
 * Replace `buildMockDashboard()` with a loader that reads cached odds + provider stats to go live.
 */
import type {
  DashboardData, Injury, LeagueId, MarketOutcome, MatchupCardData, MatchupFactors, Matchup,
  OddsQuote, Parlay, PlayerProp, Prediction, TrackedPick, ValueBet,
} from "@/types/sports";
import { LEAGUES } from "@/lib/leagues";
import { paramsFor } from "@/lib/engine/sport-params";
import { predict } from "@/lib/engine/probability";
import { priceAltLadder, rankValueBets, toValueBet } from "@/lib/engine/value";
import { priceProp, probOver } from "@/lib/engine/props";
import { buildParlay, generateParlays, toLeg } from "@/lib/engine/parlays";
import { summarize, settleProfit } from "@/lib/engine/track-record";
import { normCdf, probToAmerican } from "@/lib/odds-math";
import { assemble, type LiveBundle } from "@/lib/live/assemble";
import { DAY_TZ } from "@/lib/live/day";

// Deterministic so the UI doesn't reshuffle on every render.
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const BOOKS = [
  { key: "draftkings", name: "DraftKings" },
  { key: "fanduel", name: "FanDuel" },
  { key: "betmgm", name: "BetMGM" },
  { key: "caesars", name: "Caesars" },
];
const NOW = new Date("2026-10-04T15:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3600_000).toISOString();
const half = (x: number) => Math.floor(x) + 0.5;

function quote(american: number, i: number): OddsQuote {
  return { bookmaker: BOOKS[i % BOOKS.length], americanOdds: american, updatedAt: NOW.toISOString() };
}

function outcome(matchupId: string, market: MarketOutcome["market"], side: MarketOutcome["side"], label: string, american: number, line: number | undefined, bookIdx: number): MarketOutcome {
  const quotes = [0, 1, 2].map((k) => ({ ...quote(american - (k === 0 ? 0 : Math.round(rand() * 8) + 2), bookIdx + k), line }));
  return { id: `${matchupId}:${market}:${side}:${line ?? ""}`, matchupId, market, side, label, line, quotes, best: quotes[0] };
}

const vigged = (p: number) => probToAmerican(Math.min(0.97, p * 1.024));

interface GameSpec {
  id: string;
  league: LeagueId;
  start: number;
  home: [string, string, string, string?];
  away: [string, string, string, string?];
  venue?: Matchup["venue"];
  factors: Omit<MatchupFactors, "matchupId">;
  /** How differently the market sees the game than the model (home margin, total). Creates the value gaps. */
  marketShift: { margin: number; total: number };
  altLadder?: "spread" | "total";
}

const inj = (playerName: string, position: string, status: Injury["status"], impact: number, note?: string): Injury => ({
  playerId: playerName.toLowerCase().replace(/\W+/g, "-"), playerName, position, status, impact, note,
});
const rest = (daysRest: number, extra: Partial<MatchupFactors["home"]["rest"]> = {}) => ({ daysRest, backToBack: false, gamesLast7: 1, ...extra });

const GAMES: GameSpec[] = [
  {
    id: "nfl-buf-kc", league: "NFL", start: 5.5,
    home: ["kc", "Kansas City Chiefs", "Chiefs", "4-1"], away: ["buf", "Buffalo Bills", "Bills", "5-0"],
    venue: { name: "Arrowhead Stadium", city: "Kansas City", indoor: false, elevationFt: 820 },
    factors: {
      home: { ratings: { powerRating: 3.1, efficiency: 14.2, offense: 2.5, defense: 1.0, sampleSize: 5 }, injuries: [inj("Rashee Rice", "WR", "out", 1.4), inj("Trey Smith", "G", "questionable", 0.5)], rest: rest(7) },
      away: { ratings: { powerRating: 5.6, efficiency: 22.8, offense: 4.0, defense: 1.5, sampleSize: 5 }, injuries: [inj("Ed Oliver", "DT", "doubtful", 0.6)], rest: rest(10, { timezonesCrossed: 1, travelMiles: 960 }) },
      weather: { temperatureF: 58, windMph: 17, precipitationChance: 0.2, conditions: "Breezy" },
      headToHead: { meetings: 6, homeWins: 3, awayWins: 3, avgTotal: 50 },
      keyStarters: { home: "P. Mahomes", away: "J. Allen" },
    },
    marketShift: { margin: 1.4, total: 1.2 }, altLadder: "spread",
  },
  {
    id: "nfl-det-gb", league: "NFL", start: 2,
    home: ["gb", "Green Bay Packers", "Packers", "3-2"], away: ["det", "Detroit Lions", "Lions", "4-1"],
    venue: { name: "Lambeau Field", city: "Green Bay", indoor: false },
    factors: {
      home: { ratings: { powerRating: 1.2, offense: 0.8, defense: 0.4, sampleSize: 5 }, injuries: [inj("Jaire Alexander", "CB", "out", 0.8)], rest: rest(7) },
      away: { ratings: { powerRating: 4.4, offense: 3.6, defense: 0.6, sampleSize: 5 }, injuries: [], rest: rest(7) },
      weather: { temperatureF: 44, windMph: 21, precipitationChance: 0.55, conditions: "Rain, gusty" },
      headToHead: { meetings: 6, homeWins: 2, awayWins: 4 },
    },
    marketShift: { margin: -0.4, total: 1.6 }, altLadder: "total",
  },
  {
    id: "nba-bos-nyk", league: "NBA", start: 9,
    home: ["nyk", "New York Knicks", "Knicks", "3-1"], away: ["bos", "Boston Celtics", "Celtics", "3-1"],
    venue: { name: "Madison Square Garden", city: "New York", indoor: true },
    factors: {
      home: { ratings: { powerRating: 4.2, efficiency: 6.1, offense: 3.0, defense: 1.0, pace: 97.5, sampleSize: 4 }, injuries: [inj("Mitchell Robinson", "C", "out", 1.2)], rest: rest(2) },
      away: { ratings: { powerRating: 5.0, efficiency: 7.4, offense: 4.0, defense: 1.5, pace: 99.1, sampleSize: 4 }, injuries: [inj("Jrue Holiday", "G", "questionable", 1.5)], rest: rest(1, { backToBack: true, gamesLast7: 4 }) },
      headToHead: { meetings: 8, homeWins: 3, awayWins: 5 },
    },
    marketShift: { margin: -1.3, total: 1.0 },
  },
  {
    id: "mlb-lad-sd", league: "MLB", start: 6,
    home: ["sd", "San Diego Padres", "Padres", "93-69"], away: ["lad", "Los Angeles Dodgers", "Dodgers", "97-65"],
    venue: { name: "Petco Park", city: "San Diego", indoor: false },
    factors: {
      home: { ratings: { powerRating: 0.35, offense: 0.2, defense: 0.3, sampleSize: 162 }, injuries: [], rest: rest(1) },
      away: { ratings: { powerRating: 0.55, offense: 0.5, defense: 0.1, sampleSize: 162 }, injuries: [inj("Max Muncy", "3B", "out", 0.12)], rest: rest(1) },
      weather: { temperatureF: 68, windMph: 6, precipitationChance: 0, conditions: "Clear" },
      keyStarters: { home: "D. Cease (3.48 ERA)", away: "Y. Yamamoto (2.91 ERA)", note: "Yamamoto's ground-ball rate plays up in Petco" },
    },
    marketShift: { margin: 0.12, total: 0.35 }, altLadder: "total",
  },
  {
    id: "nhl-nyr-tor", league: "NHL", start: 7,
    home: ["tor", "Toronto Maple Leafs", "Maple Leafs", "2-1-0"], away: ["nyr", "New York Rangers", "Rangers", "1-2-0"],
    venue: { name: "Scotiabank Arena", city: "Toronto", indoor: true },
    factors: {
      home: { ratings: { powerRating: 0.32, offense: 0.3, defense: 0.0, sampleSize: 3 }, injuries: [], rest: rest(2) },
      away: { ratings: { powerRating: 0.05, offense: 0.1, defense: -0.1, sampleSize: 3 }, injuries: [inj("Igor Shesterkin", "G", "questionable", 0.35, "Starting goalie, game-time decision")], rest: rest(1, { backToBack: true }) },
    },
    marketShift: { margin: -0.1, total: 0.1 },
  },
  {
    id: "epl-ars-liv", league: "EPL", start: -1.5,
    home: ["ars", "Arsenal", "Arsenal", "5-1-1"], away: ["liv", "Liverpool", "Liverpool", "6-0-1"],
    venue: { name: "Emirates Stadium", city: "London", indoor: false },
    factors: {
      home: { ratings: { powerRating: 0.55, efficiency: 0.9, offense: 0.15, defense: 0.25, sampleSize: 7 }, injuries: [inj("Martin Ødegaard", "MF", "doubtful", 0.18)], rest: rest(6) },
      away: { ratings: { powerRating: 0.6, efficiency: 1.0, offense: 0.3, defense: 0.1, sampleSize: 7 }, injuries: [], rest: rest(3, { gamesLast7: 2 }) },
      weather: { temperatureF: 55, windMph: 9, precipitationChance: 0.4, conditions: "Overcast" },
      headToHead: { meetings: 10, homeWins: 3, awayWins: 4, draws: 3 },
    },
    marketShift: { margin: -0.06, total: 0.12 },
  },
  {
    id: "ncaaf-uga-ala", league: "NCAAF", start: 4,
    home: ["ala", "Alabama Crimson Tide", "Alabama", "4-1"], away: ["uga", "Georgia Bulldogs", "Georgia", "5-0"],
    venue: { name: "Bryant-Denny Stadium", city: "Tuscaloosa", indoor: false },
    factors: {
      home: { ratings: { powerRating: 17, offense: 6, defense: 4, sampleSize: 5 }, injuries: [], rest: rest(7) },
      away: { ratings: { powerRating: 19.5, offense: 5, defense: 7, sampleSize: 5 }, injuries: [inj("Starting LT", "OT", "out", 1.1)], rest: rest(7) },
      weather: { temperatureF: 79, windMph: 5, precipitationChance: 0.1, conditions: "Warm" },
    },
    marketShift: { margin: 1.3, total: -1.0 },
  },
  {
    id: "atp-sin-alc", league: "ATP", start: 1,
    home: ["sinner", "Jannik Sinner", "Sinner", "58-6"], away: ["alcaraz", "Carlos Alcaraz", "Alcaraz", "61-7"],
    venue: { name: "Shanghai Masters, Center Court", city: "Shanghai", indoor: false },
    factors: {
      home: { ratings: { powerRating: 0.22, sampleSize: 64 }, injuries: [], rest: rest(2) },
      away: { ratings: { powerRating: 0.28, sampleSize: 68 }, injuries: [inj("Alcaraz", "—", "probable", 0.08, "Taped right wrist in the semifinal")], rest: rest(1, { backToBack: true }) },
      headToHead: { meetings: 13, homeWins: 5, awayWins: 8 },
    },
    marketShift: { margin: -0.08, total: 0 },
  },
  {
    id: "ufc-main", league: "UFC", start: 11,
    home: ["pereira", "Alex Pereira", "Pereira", "12-3"], away: ["ankalaev", "Magomed Ankalaev", "Ankalaev", "20-1-1"],
    venue: { name: "T-Mobile Arena", city: "Las Vegas", indoor: true },
    factors: {
      home: { ratings: { powerRating: -0.05, sampleSize: 15 }, injuries: [], rest: rest(120) },
      away: { ratings: { powerRating: 0.18, sampleSize: 22 }, injuries: [], rest: rest(150) },
    },
    marketShift: { margin: -0.1, total: 0 },
  },
];

function buildGame(spec: GameSpec, idx: number): { card: MatchupCardData; bets: ValueBet[] } {
  const league = LEAGUES[spec.league];
  const P = paramsFor(spec.league);
  const matchup: Matchup = {
    id: spec.id, league: spec.league, startTime: at(spec.start), status: spec.start < 0 ? "live" : "scheduled",
    home: { id: spec.home[0], name: spec.home[1], shortName: spec.home[2], record: spec.home[3] },
    away: { id: spec.away[0], name: spec.away[1], shortName: spec.away[2], record: spec.away[3] },
    venue: spec.venue, neutralSite: league.individual,
    score: spec.start < 0 ? { home: 1, away: 1, clock: "67'", period: "2H" } : undefined,
  };
  const factors: MatchupFactors = { matchupId: spec.id, ...spec.factors };
  const pred: Prediction = predict(factors, spec.league, { neutralSite: league.individual, indoor: spec.venue?.indoor });

  // The market's view = model view shifted; that disagreement is what creates (or removes) value.
  const mktMargin = pred.projectedMargin + spec.marketShift.margin;
  const mktTotal = pred.projectedTotal + spec.marketShift.total;
  const pHomeMkt = league.hasDraw ? pred.homeWinProb + spec.marketShift.margin * 0.3 : normCdf(mktMargin / P.marginSd);
  const pDrawMkt = league.hasDraw ? pred.drawProb ?? 0.26 : 0;
  const outs: MarketOutcome[] = [
    outcome(spec.id, "moneyline", "home", `${matchup.home.shortName} ML`, vigged(pHomeMkt), undefined, idx),
    outcome(spec.id, "moneyline", "away", `${matchup.away.shortName} ML`, vigged(1 - pHomeMkt - pDrawMkt), undefined, idx + 1),
  ];
  if (league.hasDraw) outs.push(outcome(spec.id, "moneyline", "draw", "Draw", vigged(pDrawMkt), undefined, idx + 2));
  if (!league.individual && !league.hasDraw) {
    const line = -half(mktMargin);
    outs.push(outcome(spec.id, "spread", "home", `${matchup.home.shortName} ${line > 0 ? "+" : ""}${line}`, -108 - Math.round(rand() * 6), line, idx + 2));
    outs.push(outcome(spec.id, "spread", "away", `${matchup.away.shortName} ${-line > 0 ? "+" : ""}${-line}`, -108 - Math.round(rand() * 6), -line, idx + 3));
  }
  if (!["tennis", "mma"].includes(league.sport)) {
    const total = half(mktTotal);
    outs.push(outcome(spec.id, "total", "over", `Over ${total}`, -110, total, idx));
    outs.push(outcome(spec.id, "total", "under", `Under ${total}`, -110, total, idx + 1));
  }

  const why = pred.triggers.slice(0, 2).map((t) => t.label.toLowerCase()).join(" and ");
  const bets = outs
    .map((o) => toValueBet(o, pred, spec.league, `Model ${o.side === "over" || o.side === "under" ? `projects ${pred.projectedTotal.toFixed(1)} total` : `gives ${o.label.replace(" ML", "")} the edge`}; driven by ${why}.`))
    .filter((b): b is ValueBet => b != null);

  const recommended = [...bets].sort((a, b) => b.edge - a.edge)[0];
  // Alt ladder for the headline spread/total
  if (spec.altLadder) {
    const main = bets.find((b) => b.market === (spec.altLadder === "spread" ? "spread" : "total") && b.edge === Math.max(...bets.filter((x) => x.market === (spec.altLadder === "spread" ? "spread" : "total")).map((x) => x.edge)));
    if (main && main.line != null) {
      const steps = spec.altLadder === "spread" ? [-7, -3.5, 3.5, 7] : [-7, -3.5, 3.5, 7].map((s) => s * (P.totalSd / 10));
      const rungs = steps.map((s, k) => {
        const line = Math.floor(main.line! + s) + 0.5;   // hooks only: no pushes
        const tmp = priceAltLadder([{ line, americanOdds: -110, bookmaker: "" }], kindOf(main), pred, spec.league)[0];
        return { line, americanOdds: vigged(Math.max(0.05, Math.min(0.95, tmp.modelProb - 0.015 + (rand() - 0.5) * 0.03))), bookmaker: BOOKS[(idx + k) % 4].name };
      });
      main.altLines = priceAltLadder(rungs, kindOf(main), pred, spec.league);
    }
  }
  return {
    card: { matchup, prediction: pred, factors, recommended, otherBets: bets.filter((b) => b.id !== recommended.id) },
    bets,
  };
}

function kindOf(b: ValueBet): "spread_home" | "spread_away" | "over" | "under" {
  if (b.side === "over" || b.side === "under") return b.side;
  return b.side === "home" ? "spread_home" : "spread_away";
}

function buildProps(cards: MatchupCardData[]): PlayerProp[] {
  const m = (id: string) => cards.find((c) => c.matchup.id === id)!.prediction.confidenceTier;
  type Spec = Omit<Parameters<typeof priceProp>[0], "quote" | "confidence"> & { mktMean: number; book: number };
  const specs: Spec[] = [
    { id: "p1", matchupId: "nfl-buf-kc", playerId: "allen", playerName: "Josh Allen", team: "BUF", position: "QB", stat: "rushing_yards", line: 34.5, isAlt: false, side: "over", projection: { mean: 38.6, stdDev: 17, distribution: "normal" }, mktMean: 35.5, book: 0, matchupNote: "KC has allowed 31+ QB rush yds in 3 of 5 games" },
    { id: "p2", matchupId: "nfl-buf-kc", playerId: "allen", playerName: "Josh Allen", team: "BUF", position: "QB", stat: "rushing_yards", line: 24.5, isAlt: true, side: "over", projection: { mean: 38.6, stdDev: 17, distribution: "normal" }, mktMean: 35.5, book: 1 },
    { id: "p3", matchupId: "nfl-buf-kc", playerId: "kelce", playerName: "Travis Kelce", team: "KC", position: "TE", stat: "receptions", line: 5.5, isAlt: false, side: "over", projection: { mean: 6.2, distribution: "poisson" }, mktMean: 5.8, book: 2, matchupNote: "Rice out: Kelce averages 9.1 targets without him" },
    { id: "p4", matchupId: "nfl-det-gb", playerId: "gibbs", playerName: "Jahmyr Gibbs", team: "DET", position: "RB", stat: "rushing_yards", line: 71.5, isAlt: false, side: "over", projection: { mean: 76, stdDev: 26, distribution: "normal" }, mktMean: 72, book: 3, matchupNote: "21 mph gusts push both teams toward the run" },
    { id: "p5", matchupId: "nfl-det-gb", playerId: "goff", playerName: "Jared Goff", team: "DET", position: "QB", stat: "passing_yards", line: 254.5, isAlt: false, side: "under", projection: { mean: 247, stdDev: 45, distribution: "normal" }, mktMean: 256, book: 0, matchupNote: "Rain and wind; Goff averages 41 fewer yards in bad weather" },
    { id: "p6", matchupId: "nba-bos-nyk", playerId: "brunson", playerName: "Jalen Brunson", team: "NYK", position: "G", stat: "points_rebounds_assists", line: 38.5, isAlt: false, side: "over", projection: { mean: 40.1, stdDev: 7.5, distribution: "normal" }, mktMean: 38.9, book: 1, matchupNote: "Holiday questionable; Boston on a back-to-back" },
    { id: "p7", matchupId: "nba-bos-nyk", playerId: "brunson", playerName: "Jalen Brunson", team: "NYK", position: "G", stat: "points_rebounds_assists", line: 33.5, isAlt: true, side: "over", projection: { mean: 40.1, stdDev: 7.5, distribution: "normal" }, mktMean: 38.9, book: 2 },
    { id: "p8", matchupId: "nba-bos-nyk", playerId: "tatum", playerName: "Jayson Tatum", team: "BOS", position: "F", stat: "threes", line: 3.5, isAlt: false, side: "under", projection: { mean: 3.3, distribution: "poisson" }, mktMean: 3.6, book: 3 },
    { id: "p9", matchupId: "mlb-lad-sd", playerId: "yamamoto", playerName: "Yoshinobu Yamamoto", team: "LAD", position: "SP", stat: "strikeouts", line: 6.5, isAlt: false, side: "over", projection: { mean: 7.1, distribution: "poisson" }, mktMean: 6.7, book: 0, matchupNote: "San Diego strikes out 24.6% vs RHP (8th-most)" },
    { id: "p10", matchupId: "mlb-lad-sd", playerId: "yamamoto", playerName: "Yoshinobu Yamamoto", team: "LAD", position: "SP", stat: "strikeouts", line: 4.5, isAlt: true, side: "over", projection: { mean: 7.1, distribution: "poisson" }, mktMean: 6.7, book: 1 },
    { id: "p11", matchupId: "nhl-nyr-tor", playerId: "matthews", playerName: "Auston Matthews", team: "TOR", position: "C", stat: "shots_on_goal", line: 4.5, isAlt: false, side: "over", projection: { mean: 4.6, distribution: "poisson" }, mktMean: 4.3, book: 2, matchupNote: "Rangers' backup goalie likely; Matthews averages 5.3 SOG at home" },
    { id: "p12", matchupId: "ufc-main", playerId: "ankalaev", playerName: "Magomed Ankalaev", team: "UFC", stat: "significant_strikes", line: 54.5, isAlt: false, side: "over", projection: { mean: 58, stdDev: 22, distribution: "normal" }, mktMean: 55, book: 3 },
  ];
  return specs.map(({ mktMean, book, ...s }) => {
    const pOverMkt = probOver({ ...s.projection, mean: mktMean }, s.line);
    const pSide = s.side === "over" ? pOverMkt : 1 - pOverMkt;
    // books charge more on props: about 4.5% overround per side
    const american = probToAmerican(Math.min(0.96, pSide * 1.045));
    return priceProp({ ...s, quote: quote(american, book), confidence: m(s.matchupId) });
  });
}

function buildTrackRecord(): TrackedPick[] {
  const leagues: LeagueId[] = ["NFL", "NBA", "MLB", "NHL", "EPL", "NCAAF", "ATP", "UFC"];
  const picks: TrackedPick[] = [];
  for (let i = 0; i < 64; i++) {
    const kind = i % 7 === 0 ? "parlay" : i % 3 === 0 ? "prop" : "single";
    const odds = kind === "parlay" ? 250 + Math.round(rand() * 400) : rand() < 0.6 ? -(105 + Math.round(rand() * 60)) : 100 + Math.round(rand() * 80);
    const breakEven = 1 / (odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds);
    const modelProb = breakEven + 0.02 + rand() * 0.03;
    const win = rand() < breakEven + (kind === "parlay" ? 0.0 : 0.01);   // a realistic, small real-world edge
    const p: TrackedPick = {
      id: `t${i}`, placedAt: at(-24 * (i / 3 + 1)), settledAt: at(-24 * (i / 3 + 1) + 4), league: leagues[i % leagues.length], kind,
      label: kind === "parlay" ? `${3 + (i % 3)}-leg parlay` : kind === "prop" ? "Player prop" : "Single",
      americanOdds: odds, units: kind === "parlay" ? 0.5 : 1, modelProb, edgeAtPick: 0.02 + rand() * 0.05,
      closingOdds: odds + (rand() < 0.62 ? -8 : 6), result: rand() < 0.03 ? "push" : win ? "win" : "loss",
    };
    p.profitUnits = settleProfit(p);
    picks.push(p);
  }
  // Keep the demo honest: real long-run ROI for a good model is low single digits, not 20%+.
  const roi = () => summarize(picks).roi;
  for (let i = 0; i < picks.length && roi() > 0.06; i++) {
    const p = picks[(i * 7) % picks.length];
    if (p.result === "win") { p.result = "loss"; p.profitUnits = settleProfit(p); }
  }
  for (let i = 0; i < picks.length && roi() < 0.02; i++) {
    const p = picks[(i * 5) % picks.length];
    if (p.result === "loss" && p.kind === "single") { p.result = "win"; p.profitUnits = settleProfit(p); }
  }
  return picks;
}

/** Raw mock pieces, shared by the single-page mock and the day-by-day bundle. */
export function mockParts() {
  seed = 42;
  const built = GAMES.map(buildGame);
  const cards = built.map((b) => b.card);
  const allBets = built.flatMap((b) => b.bets);
  const props = buildProps(cards);
  const history = buildTrackRecord();
  return { cards, allBets, props, history };
}

/** Mock data in the same day-by-day shape as the live builder, so the day picker works before going live. */
export function buildMockBundle(): LiveBundle {
  const { cards, allBets, props, history } = mockParts();
  return assemble({
    cards, bets: allBets, props, history, generatedAt: NOW.toISOString(), isMock: true, tz: DAY_TZ,
    status: { sources: [], notes: ["Showing mock data: the live data builder hasn't run yet."] },
  });
}

export function buildMockDashboard(): DashboardData {
  const { cards, allBets, props, history: hist } = mockParts();
  // Pregame prices go stale the moment a game starts, so only scheduled games produce picks.
  const open = new Set(cards.filter((c) => c.matchup.status === "scheduled").map((c) => c.matchup.id));
  const openBets = allBets.filter((b) => open.has(b.matchupId));
  const openProps = props.filter((p) => open.has(p.matchupId));
  const topPicks = rankValueBets(openBets).slice(0, 8);

  const parlays: Parlay[] = generateParlays([...rankValueBets(openBets), ...openProps.filter((p) => p.edge >= 0)]);
  // Same-game parlay with positively correlated legs: Bills win + Allen rushes + game stays under in the wind.
  const sgpLegs = [
    allBets.find((b) => b.matchupId === "nfl-buf-kc" && b.market === "moneyline" && b.side === "away"),
    props.find((p) => p.id === "p1"),
    allBets.find((b) => b.matchupId === "nfl-buf-kc" && b.market === "total" && b.side === "under"),
  ].filter((x): x is ValueBet | PlayerProp => x != null);
  if (sgpLegs.length >= 2) {
    parlays.push(buildParlay("same_game", "Bills SGP: Allen on the ground", sgpLegs.map(toLeg),
      "Allen scrambling is how Buffalo wins this; a windy, run-heavy script also helps the Under. Correlation factor 1.18.", 1.18));
  }

  const history = hist;
  return {
    generatedAt: NOW.toISOString(),
    isMock: true,
    topPicks,
    matchups: cards,
    props: props.sort((a, b) => b.edge - a.edge),
    parlays,
    trackRecord: summarize(history),
    recentResults: history.slice(0, 12),
  };
}
