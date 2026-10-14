/**
 * Core domain types for the Edge Analytics dashboard.
 *
 * Conventions
 * - Probabilities are 0..1 floats. Percent values are only produced at the UI layer.
 * - American odds are integers (e.g. -110, +145). Decimal odds are derived in lib/odds-math.ts.
 * - Every timestamp is an ISO-8601 string in UTC.
 */

// ---------------------------------------------------------------------------
// Leagues & participants
// ---------------------------------------------------------------------------

export type Sport = "football" | "basketball" | "baseball" | "hockey" | "soccer" | "tennis" | "mma";

export type LeagueId =
  | "NFL"
  | "NCAAF"
  | "NBA"
  | "NCAAB"
  | "MLB"
  | "NHL"
  | "EPL"
  | "MLS"
  | "UCL"
  | "LALIGA"
  | "SERIEA"
  | "BUNDESLIGA"
  | "LIGUE1"
  | "WNBA"
  | "NCAAW"
  | "ATP"
  | "WTA"
  | "UFC";

export interface League {
  id: LeagueId;
  name: string;
  sport: Sport;
  /** Can the event end in a draw (soccer)? Changes moneyline math to 3-way. */
  hasDraw: boolean;
  /** Individual sports (tennis, MMA) have no home/away venue edge. */
  individual: boolean;
}

/** A team or an individual athlete (tennis player, fighter). */
export interface Competitor {
  id: string;
  name: string;
  shortName: string;
  abbreviation?: string;
  logoUrl?: string;
  /** Team color as "#RRGGBB" (from ESPN). */
  color?: string;
  record?: string; // "7-2", "18-4-1", "23-1 (MMA)"
}

export type EventStatus = "scheduled" | "live" | "final" | "postponed";

export interface Venue {
  name: string;
  city: string;
  indoor: boolean;
  /** Feet above sea level; altitude matters (Denver, Mexico City). */
  elevationFt?: number;
}

export interface Matchup {
  id: string;
  league: LeagueId;
  startTime: string;
  status: EventStatus;
  /** NFL week number (from ESPN). */
  week?: number;
  home: Competitor;
  away: Competitor;
  venue?: Venue;
  neutralSite?: boolean;
  /** Live / final score, if the event has started. */
  score?: { home: number; away: number; clock?: string; period?: string };
}

// ---------------------------------------------------------------------------
// Odds & markets
// ---------------------------------------------------------------------------

export type MarketType =
  | "moneyline"
  | "spread"
  | "total"
  | "alt_spread"
  | "alt_total"
  | "player_prop"
  | "alt_player_prop";

export type Side = "home" | "away" | "draw" | "over" | "under" | "yes" | "no";

export interface Bookmaker {
  key: string; // "draftkings"
  name: string; // "DraftKings"
}

/** One price for one outcome at one book. */
export interface OddsQuote {
  bookmaker: Bookmaker;
  americanOdds: number;
  /** Spread/total/prop line; undefined for moneylines. */
  line?: number;
  updatedAt: string;
}

/** All prices for a single outcome (e.g. "Bills -3.5") across books. */
export interface MarketOutcome {
  id: string;
  matchupId: string;
  market: MarketType;
  side: Side;
  /** Human label, e.g. "Bills -3.5" or "Over 47.5". */
  label: string;
  line?: number;
  quotes: OddsQuote[];
  /** Best (highest-paying) quote across books. */
  best: OddsQuote;
}

/** Snapshot used for caching & line-movement tracking. */
export interface OddsSnapshot {
  matchupId: string;
  fetchedAt: string;
  outcomes: MarketOutcome[];
}

export interface LineMovement {
  outcomeId: string;
  openingOdds: number;
  currentOdds: number;
  openingLine?: number;
  currentLine?: number;
  /** Positive = the price got shorter (money came in on this side). */
  impliedShiftPts: number;
}

// ---------------------------------------------------------------------------
// Engine inputs: the matchup factors
// ---------------------------------------------------------------------------

/** Advanced team-strength metrics. Fields are sport-specific and optional. */
export interface TeamRatings {
  /** Generic power rating in points/goals above average (engine's common currency). */
  powerRating: number;
  /** Football: DVOA-style efficiency (%), basketball: net rating, soccer: xG differential per 90. */
  efficiency?: number;
  offense?: number;
  defense?: number;
  /** Possessions/plays per game; drives total projections. */
  pace?: number;
  /** Games in the current sample; used to shrink ratings early in a season. */
  sampleSize: number;
}

export type InjuryStatus = "out" | "doubtful" | "questionable" | "probable" | "day_to_day";

export interface Injury {
  playerId: string;
  playerName: string;
  position: string;
  status: InjuryStatus;
  /** Estimated value lost in the engine's units (points/goals) if the player sits. */
  impact: number;
  note?: string;
}

export interface RestContext {
  daysRest: number;
  backToBack: boolean;
  /** Games in the last N days (fatigue). */
  gamesLast7: number;
  travelMiles?: number;
  timezonesCrossed?: number;
}

export interface WeatherContext {
  temperatureF: number;
  windMph: number;
  precipitationChance: number; // 0..1
  conditions: string;
}

export interface HeadToHead {
  meetings: number;
  homeWins: number;
  awayWins: number;
  draws?: number;
  avgTotal?: number;
}

export interface MatchupFactors {
  matchupId: string;
  home: { ratings: TeamRatings; injuries: Injury[]; rest: RestContext };
  away: { ratings: TeamRatings; injuries: Injury[]; rest: RestContext };
  weather?: WeatherContext;
  headToHead?: HeadToHead;
  /** Sport-specific starters that dominate outcomes (MLB pitcher, NHL goalie, NFL QB). */
  keyStarters?: { home?: string; away?: string; note?: string };
}

/** One explained contribution to the projection, shown in the "Matchup Analysis" accordion. */
export interface FactorTrigger {
  category: "ratings" | "injury" | "rest" | "travel" | "weather" | "head_to_head" | "venue" | "starter";
  label: string;
  detail: string;
  /** Effect on the home side's expected margin, in the sport's units. */
  marginImpact: number;
  /** Effect on the projected total, in the sport's units. */
  totalImpact?: number;
  severity: "low" | "medium" | "high";
}

// ---------------------------------------------------------------------------
// Engine outputs
// ---------------------------------------------------------------------------

export type ConfidenceTier = "low" | "medium" | "high" | "elite";

export interface Prediction {
  matchupId: string;
  generatedAt: string;
  modelVersion: string;
  /** Model probabilities, independent of sportsbook prices. */
  homeWinProb: number;
  awayWinProb: number;
  drawProb?: number;
  projectedScore: { home: number; away: number };
  projectedMargin: number; // home minus away
  projectedTotal: number;
  /** 0..1 reliability of the projection (data completeness, sample size, volatility). */
  confidence: number;
  confidenceTier: ConfidenceTier;
  triggers: FactorTrigger[];
}

/** A priced recommendation: model probability vs. the market's implied probability. */
export interface ValueBet {
  id: string;
  matchupId: string;
  market: MarketType;
  side: Side;
  label: string;
  line?: number;
  bestQuote: OddsQuote;
  modelProb: number;
  impliedProb: number;
  /** modelProb - impliedProb, in probability points (0.04 = 4 pts). */
  edge: number;
  /** Expected profit per 1 unit staked. */
  expectedValue: number;
  /** Suggested stake as a fraction of bankroll (fractional Kelly, capped). */
  kellyFraction: number;
  confidence: ConfidenceTier;
  rationale: string;
  /** "large_gap": the model disagrees with the market by 10+ points, which usually means missing information. */
  flags?: ("large_gap")[];
  /** Sportsbooks' no-vig chance (median across books); modelProb is this nudged toward the model. */
  marketProb?: number;
  /** The factor model's own chance (shown as a lean only; picks come from the market). */
  modelOnlyProb?: number;
  /** How many sportsbooks priced both sides (the consensus behind marketProb). */
  marketBooks?: number;
  /** Every book's price for this exact line, best first (the best-price finder). */
  books?: { name: string; odds: number }[];
  /** First best price the site saw for this side (line may differ from today's). */
  opening?: { line?: number; americanOdds: number; at: string };
  /** Alt-line ladder for this market, if one exists (alt spreads / totals). */
  altLines?: AltLine[];
}

export interface AltLine {
  line: number;
  americanOdds: number;
  bookmaker: string;
  modelProb: number;
  edge: number;
  /** Chance from the sportsbooks' main line alone, and from the model alone (modelProb blends them). */
  marketProb?: number;
  modelOnlyProb?: number;
}

// ---------------------------------------------------------------------------
// Player props
// ---------------------------------------------------------------------------

export type PropStat =
  | "points"
  | "rebounds"
  | "assists"
  | "points_rebounds_assists"
  | "threes"
  | "passing_yards"
  | "rushing_yards"
  | "receiving_yards"
  | "receptions"
  | "passing_tds"
  | "anytime_td"
  | "strikeouts"
  | "hits"
  | "total_bases"
  | "shots_on_goal"
  | "goals"
  | "shots_on_target"
  | "aces"
  | "significant_strikes";

export interface PlayerProjection {
  mean: number;
  /** Standard deviation used to price any line (normal) or "poisson" for count stats. */
  stdDev?: number;
  /**
   * "empirical": single-game results divided by the player's average, measured from real games (yards are lopsided:
   * lots of modest games and a few big ones). quantiles = those ratios at evenly spaced percentiles.
   */
  distribution: "normal" | "poisson" | "empirical";
  quantiles?: number[];
  /** Typical (median) game, which for yards sits below the average. */
  median?: number;
  minutesOrSnaps?: number;
}

export interface PlayerProp {
  id: string;
  matchupId: string;
  playerId: string;
  playerName: string;
  team: string;
  position?: string;
  stat: PropStat;
  statLabel: string; // "Pts+Reb+Ast"
  line: number;
  isAlt: boolean;
  side: Extract<Side, "over" | "under" | "yes" | "no">;
  bestQuote: OddsQuote;
  projection: PlayerProjection;
  modelProb: number;
  impliedProb: number;
  edge: number;
  confidence: ConfidenceTier;
  rationale: string;
  /** Opponent context surfaced in the UI ("Opp. allows 4th-most rush yds"). */
  matchupNote?: string;
  /** "large_gap": 12+ points off the market, usually missing information. */
  flags?: ("large_gap")[];
  /** Where the price came from when it isn't a sportsbook (e.g. a Kalshi ladder rung). */
  source?: "kalshi" | "sportsbook";
  /** Kalshi market ticker, used to grade from Kalshi's settled result. */
  ticker?: string;
  /** Our chance from our player projection (recent form, opponent, game script, injured teammates). */
  ourProb?: number;
  /** One-line reason behind ourProb. */
  why?: string;
}

// ---------------------------------------------------------------------------
// Parlays
// ---------------------------------------------------------------------------

export type ParlayTier = "bankroll_builder" | "value_booster" | "lotto" | "same_game";

export interface ParlayLeg {
  /** Points at a ValueBet or PlayerProp id. */
  refId: string;
  kind: "bet" | "prop";
  matchupId: string;
  label: string;
  americanOdds: number;
  modelProb: number;
}

export interface Parlay {
  id: string;
  tier: ParlayTier;
  title: string;
  legs: ParlayLeg[];
  combinedAmericanOdds: number;
  /** Product of leg probabilities, adjusted by the correlation factor for SGPs. */
  modelHitProb: number;
  impliedHitProb: number;
  expectedValue: number;
  /** >1 means legs tend to win together (positively correlated SGP). */
  correlationFactor: number;
  rationale: string;
}

export interface ParlayTierConfig {
  tier: ParlayTier;
  label: string;
  minLegs: number;
  maxLegs: number;
  /** Minimum per-leg model probability the generator will accept. */
  minLegProb: number;
  description: string;
}

// ---------------------------------------------------------------------------
// Transparency / track record
// ---------------------------------------------------------------------------

export type PickResult = "pending" | "win" | "loss" | "push" | "void";

export interface TrackedPick {
  id: string;
  placedAt: string;
  settledAt?: string;
  league: LeagueId;
  kind: "single" | "prop" | "alt" | "parlay" | "lock" | "ours" | "ourparlay";
  label: string;
  americanOdds: number;
  units: number;
  modelProb: number;
  edgeAtPick: number;
  /** Price at kickoff; beating it consistently is the best sign the model has real edge. */
  closingOdds?: number;
  result: PickResult;
  profitUnits?: number;
  /** Model version that made the pick, so fixes don't get mixed with older (buggier) records. */
  modelVersion?: string;
  /** "NFL spreads", "NCAAF totals", "NFL props", "parlays"... used for per-type records and auto-pause. */
  betType?: string;
  /** What's needed to grade it later (market/side/line, Kalshi ticker, player/stat, parlay legs). */
  grade?: GradeInfo;
}

export interface GradeInfo {
  matchupId: string;
  market: string;            // moneyline | spread | total | alt_spread | alt_total | prop | parlay
  side?: string;
  line?: number;
  home?: string;
  away?: string;
  start?: string;
  ticker?: string;           // Kalshi market ticker (settles Yes/No)
  player?: string;
  stat?: string;
  homeAbbr?: string;
  awayAbbr?: string;
  legs?: (GradeInfo & { americanOdds: number; result?: PickResult; label?: string })[];
}

/**
 * Is the model any good? Straight bets only (parlays compound the legs): do its hit chances come true, and does the
 * market move toward its picks before the game? Both answer faster than a win-loss record.
 */
export interface ModelCheck {
  picks: number;
  wins: number;
  /** Sum of the model's hit chances: the wins it expected. */
  expectedWins: number;
  buckets: { label: string; picks: number; predicted: number; actual: number }[];
  clvSample: number;
  /** Share of picks whose price shortened before the game (the market moved our way). */
  beatCloseRate: number | null;
  /** Average move toward our pick, in implied-probability points (positive is good). */
  avgClvPts: number | null;
  verdict: "too_early" | "overconfident" | "underconfident" | "on_track";
}

/** Final scores by matchup id (public/data/results.json), used to settle tracked bets in the browser. */
export type GameResults = Record<string, { home: number; away: number; homeTeam: string; awayTeam: string; start: string }>;

export interface TeaserLeg {
  side: "home" | "away";
  team: string;
  /** Main spread for this side, and after the 6-point tease. */
  line: number;
  teased: number;
  /** Share of similar games since 2010 this side covered the teased line (pushes count as not covering). */
  prob: number;
  /** Classic "Wong" leg: the tease crosses both 3 and 7 (favorites -7.5 to -8.5, underdogs +1.5 to +2.5). */
  wong: boolean;
}

export interface TrackRecordSummary {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  unitsWagered: number;
  unitsProfit: number;
  roi: number; // profit / wagered
  /** Share of picks whose price beat the closing line. */
  closingLineValueRate: number;
  /** How many settled picks had a closing price recorded (0 = no closing-line data yet). */
  closingSample?: number;
  byTier: Record<string, { picks: number; wins: number; roi: number }>;
  /** Record per bet type ("NFL spreads", "NCAAF totals", "NFL props", "parlays"). clv = share that beat the close. */
  byType?: Record<string, { picks: number; wins: number; losses: number; roi: number; clv: number | null }>;
}

// ---------------------------------------------------------------------------
// Aggregate view model consumed by the dashboard
// ---------------------------------------------------------------------------

export interface MatchupCardData {
  matchup: Matchup;
  prediction: Prediction;
  factors: MatchupFactors;
  recommended: ValueBet;
  /** Other priced markets for the same game (spread/total/ML not chosen as the headline). */
  otherBets: ValueBet[];
  /** Alt spread / alt total ladders (e.g. from Kalshi), each rung priced against the model. */
  altLadders?: ValueBet[];
  /** 6-point teaser legs for this game: the main spread teased 6 points, with the real cover rate since 2010. */
  teasers?: TeaserLeg[];
  /** The sportsbooks' main line for this game: home margin (minus the home spread) and total. */
  marketLine?: { margin?: number; total?: number };
  /** Every factor behind this game's projection, for the "Why?" lists. */
  why?: WhyPart[];
}

/**
 * One reason behind a pick, for the "Why?" list. Direction comes from the effect fields:
 *   m: points of home margin (+ helps home), t: points of total (+ helps the over)   [game lines]
 *   f: multiplier on the player's stat (above 1 = more of it)                         [props]
 *   v: our projected stat (compared with each prop's line)
 * ctx: shown for context but not part of our number.
 */
export interface WhyPart { k: string; text: string; m?: number; t?: number; f?: number; v?: number; ctx?: boolean }

/** One anytime-touchdown candidate for the TD derby. */
export interface TdCandidate {
  id: string;
  matchupId: string;
  start: string;
  player: string;
  pos: string;
  team: string;
  opponent: string;
  /** Expected touchdowns and the chance of scoring at least one. */
  expectedTds: number;
  prob: number;
  fairOdds: number;
  /** Best available price, if a market lists him (Kalshi anytime TD). */
  price?: { americanOdds: number; book: string };
  edge?: number;
  note: string;
}

/** A recommended alt line or alt prop, ready to display. */
export interface AltPick {
  id: string;
  matchupId: string;
  league: LeagueId;
  kind: "alt_prop" | "alt_spread" | "alt_total";
  label: string;
  detail: string;
  americanOdds: number;
  book: string;
  modelProb: number;
  impliedProb: number;
  edge: number;
  why: string;
  /** Grading info for the transparency log. */
  grade?: GradeInfo;
  /** The same bet in Kalshi's wording, e.g. "Yes · Chiefs win by over 6.5". */
  kalshi?: string;
}

export interface DashboardData {
  generatedAt: string;
  isMock: boolean;
  topPicks: ValueBet[];
  matchups: MatchupCardData[];
  props: PlayerProp[];
  parlays: Parlay[];
  /** Best alt lines and alt props for the slate (model probability vs. price). */
  altPicks?: AltPick[];
  /** Anytime-touchdown candidates, most likely first. */
  tdDerby?: TdCandidate[];
  trackRecord: TrackRecordSummary;
  /** Locks: the likeliest fairly priced straight bets, one per game. */
  locks?: ValueBet[];
  /** The locks' own record, kept out of trackRecord. */
  locksRecord?: TrackRecordSummary;
  /** Our Picks: the top "most likely to hit" bets logged automatically before each kickoff window. */
  oursRecord?: TrackRecordSummary;
  oursCheck?: ModelCheck;
  /** Our Picks, newest first (last 150). */
  oursPicks?: TrackedPick[];
  /** Since the 10/13 fixes (juice cap, 3-point edge rule): Our Picks vs the best-price (value) log, side by side. */
  oursRecordNew?: TrackRecordSummary;
  bestRecordNew?: TrackRecordSummary;
  /** The site's own parlays (logged before the day's games) and their record. */
  parlayRecord?: TrackRecordSummary;
  parlayPicks?: TrackedPick[];
  /** trackRecord without parlays and props: game picks and alt lines only. */
  straightRecord?: TrackRecordSummary;
  /** Calibration and closing-line check for the current model's straight bets. */
  modelCheck?: ModelCheck;
  /** Picks made by earlier model versions, kept separate so fixes are judged on their own. */
  legacyRecord?: TrackRecordSummary;
  recentResults: TrackedPick[];
}
