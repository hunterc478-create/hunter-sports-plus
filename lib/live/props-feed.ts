/**
 * Optional player props from The Odds API (needs THE_ODDS_API_KEY; free tier = 500 credits/month).
 * Free stats feeds don't include player projections, so the starting projection is backed out of the
 * books' main line, then adjusted by the matchup: how many points the model projects this team to score
 * versus its season average. Props on teams the model expects to score more get pushed up, and vice versa.
 */
import { MODEL_WEIGHT } from "@/lib/engine/value";
import type { ConfidenceTier, LeagueId, PlayerProp, PropStat, Prediction } from "@/types/sports";
import { ODDS_API_KEYS } from "@/lib/leagues";
import { devig } from "@/lib/odds-math";
import { priceProp } from "@/lib/engine/props";
import { getJson } from "./http";

const MARKETS: Partial<Record<LeagueId, { key: string; stat: PropStat; dist: "normal" | "poisson"; sdShare?: number }[]>> = {
  // 5 markets = 5 credits per game; each game is pulled once before kickoff (~80 credits a week).
  // Alt ladders (below) add 4 credits and are pulled for primetime games only.
  NFL: [
    { key: "player_pass_yds", stat: "passing_yards", dist: "normal", sdShare: 0.2 },
    { key: "player_pass_tds", stat: "passing_tds", dist: "poisson" },
    { key: "player_rush_yds", stat: "rushing_yards", dist: "normal", sdShare: 0.42 },
    { key: "player_reception_yds", stat: "receiving_yards", dist: "normal", sdShare: 0.5 },
    { key: "player_receptions", stat: "receptions", dist: "poisson" },
  ],
  NBA: [
    { key: "player_points", stat: "points", dist: "normal", sdShare: 0.28 },
    { key: "player_points_rebounds_assists", stat: "points_rebounds_assists", dist: "normal", sdShare: 0.22 },
  ],
  MLB: [{ key: "pitcher_strikeouts", stat: "strikeouts", dist: "poisson" }, { key: "batter_total_bases", stat: "total_bases", dist: "poisson" }],
  NHL: [{ key: "player_shots_on_goal", stat: "shots_on_goal", dist: "poisson" }],
};

/** Alt prop ladders ("70+ yards"), pulled only when asked (primetime games) to fit the free credits. */
const ALT_MARKETS: Partial<Record<LeagueId, { key: string; stat: PropStat; dist: "normal" | "poisson"; sdShare?: number }[]>> = {
  NFL: [
    { key: "player_pass_yds_alternate", stat: "passing_yards", dist: "normal", sdShare: 0.2 },
    { key: "player_rush_yds_alternate", stat: "rushing_yards", dist: "normal", sdShare: 0.42 },
    { key: "player_reception_yds_alternate", stat: "receiving_yards", dist: "normal", sdShare: 0.5 },
    { key: "player_receptions_alternate", stat: "receptions", dist: "poisson" },
  ],
};
/** The books the user bets at; up to 10 named books cost the same as one region. */
const BOOKS = process.env.PROP_BOOKS ?? "fanduel,fliff,draftkings,betmgm,williamhill_us,espnbet,betrivers,fanatics,hardrockbet";
type Ev = { id: string; home_team: string; away_team: string };
const eventCache = new Map<string, Promise<Ev[] | null>>();
type Book = { key: string; title: string; markets: { key: string; outcomes: { name: string; description?: string; price: number; point?: number }[] }[] };

export async function getProps(league: LeagueId, game: { matchupId: string; home: string; away: string; homeAvgPts?: number; awayAvgPts?: number; homeRoster?: string[]; awayRoster?: string[] }, pred: Prediction, confidence: ConfidenceTier, alts = false): Promise<PlayerProp[] | null> {
  const apiKey = process.env.THE_ODDS_API_KEY;
  const sport = ODDS_API_KEYS[league];
  const markets = MARKETS[league] && [...MARKETS[league]!, ...(alts ? ALT_MARKETS[league] ?? [] : [])];
  if (!apiKey || !sport || !markets) return null;
  // the event list is free and the same for every game this run, so fetch it once
  if (!eventCache.has(sport)) eventCache.set(sport, getJson<Ev[]>(`https://api.the-odds-api.com/v4/sports/${sport}/events`, { apiKey }));
  const events = await eventCache.get(sport)!;
  if (!events) return null;   // request refused (bad key / out of credits) or failed
  const same = (a: string, b: string) => a.split(" ").slice(-1)[0].toLowerCase() === b.split(" ").slice(-1)[0].toLowerCase();
  const ev = events?.find((e) => same(e.home_team, game.home) && same(e.away_team, game.away));
  if (!ev) return [];
  const data = await getJson<{ bookmakers: Book[] }>(`https://api.the-odds-api.com/v4/sports/${sport}/events/${ev.id}/odds`, {
    apiKey, bookmakers: BOOKS, markets: markets.map((m) => m.key).join(","), oddsFormat: "american",
  });
  if (!data) return null;

  // matchup multiplier: projected team score vs season average
  const mult = (team: "home" | "away") => {
    const avg = team === "home" ? game.homeAvgPts : game.awayAvgPts;
    const proj = team === "home" ? pred.projectedScore.home : pred.projectedScore.away;
    if (!avg || avg <= 0) return 1;
    // a nudge, not a swing: a quarter of the team-level change, capped at +/-6%
    return Math.max(0.94, Math.min(1.06, 1 + 0.25 * (proj / avg - 1)));
  };

  type Row = { stat: PropStat; dist: "normal" | "poisson"; sdShare?: number; player: string; line: number; alt: boolean; over: { price: number; book: string }[]; under: { price: number; book: string }[] };
  const rows = new Map<string, Row>();
  for (const bk of data.bookmakers ?? []) {
    for (const mk of bk.markets) {
      const cfg = markets.find((m) => m.key === mk.key);
      if (!cfg) continue;
      for (const o of mk.outcomes) {
        if (!o.description || o.point === undefined) continue;
        const k = `${mk.key}|${o.description}|${o.point}`;
        const r = rows.get(k) ?? { stat: cfg.stat, dist: cfg.dist, sdShare: cfg.sdShare, player: o.description, line: o.point, alt: mk.key.endsWith("_alternate"), over: [], under: [] };
        (o.name === "Over" ? r.over : r.under).push({ price: o.price, book: bk.title });
        rows.set(k, r);
      }
    }
  }

  const props: PlayerProp[] = [];
  for (const r of rows.values()) {
    // alt ladders are usually Over-only ("70+ yards"): no consensus to back out, so the price stands as its own fair
    // chance and our projection (added later) does the judging
    if (r.alt && r.over.length && !r.under.length) {
      const best = r.over.reduce((a, b) => (b.price > a.price ? b : a));
      const implied = best.price > 0 ? 100 / (best.price + 100) : -best.price / (-best.price + 100);
      const sd0 = Math.max(1, r.line * (r.sdShare ?? 0.3));
      props.push(priceProp({
        id: `${game.matchupId}:${r.stat}:${r.player}:${r.line}:over:alt`.replace(/\s+/g, "_"), matchupId: game.matchupId,
        playerId: r.player.toLowerCase().replace(/\W+/g, "-"), playerName: r.player, team: "", stat: r.stat, line: r.line, isAlt: true, side: "over",
        quote: { bookmaker: { key: best.book.toLowerCase(), name: best.book }, americanOdds: best.price, updatedAt: new Date().toISOString() },
        projection: { mean: r.line, stdDev: r.dist === "normal" ? sd0 : undefined, distribution: r.dist }, confidence,
      }));
      const p = props[props.length - 1];
      p.modelProb = implied; p.edge = 0;
      continue;
    }
    if (!r.over.length || !r.under.length) continue;
    // fair P(over) at the main line, median across books
    const pairs = r.over.map((o) => [o, r.under.find((u) => u.book === o.book)] as const).filter(([, u]) => u);
    if (!pairs.length) continue;
    const pOvers = pairs.map(([o, u]) => devig([o.price, u!.price])[0]).sort((a, b) => a - b);
    const pOver = pOvers[Math.floor(pOvers.length / 2)];
    // back out a mean whose distribution puts pOver above the line, then apply the matchup multiplier
    const sd = (m: number) => Math.max(1, m * (r.sdShare ?? 0.3));
    let mean = r.line;
    for (let i = 0; i < 40; i++) {
      const p = r.dist === "poisson" ? poissonOver(mean, r.line) : 1 - normCdf((r.line - mean) / sd(mean));
      mean += (pOver - p) * (r.dist === "poisson" ? 2 : sd(mean) * 1.5);
      mean = Math.max(0.1, mean);
    }
    const teamSide = guessTeam(r.player, game);
    // matchup tilt from the team model, scaled by the engine's model weight (0 = pure book consensus)
    const adj = teamSide ? 1 + MODEL_WEIGHT * (mult(teamSide) - 1) : 1;
    const projection = { mean: mean * adj, stdDev: r.dist === "normal" ? sd(mean * adj) : undefined, distribution: r.dist };
    for (const side of ["over", "under"] as const) {
      const best = (side === "over" ? r.over : r.under).reduce((a, b) => (b.price > a.price ? b : a));
      props.push(priceProp({
        id: `${game.matchupId}:${r.stat}:${r.player}:${r.line}:${side}`.replace(/\s+/g, "_"), matchupId: game.matchupId,
        playerId: r.player.toLowerCase().replace(/\W+/g, "-"), playerName: r.player, team: teamSide === "home" ? game.home : teamSide === "away" ? game.away : "", stat: r.stat, line: r.line, isAlt: r.alt, side,
        quote: { bookmaker: { key: best.book.toLowerCase(), name: best.book }, americanOdds: best.price, updatedAt: new Date().toISOString() },
        projection, confidence,
        matchupNote: adj !== 1 ? `Matchup adjustment ${adj > 1 ? "+" : ""}${((adj - 1) * 100).toFixed(0)}% (team projected ${adj > 1 ? "above" : "below"} its scoring average)` : undefined,
      }));
    }
  }
  // keep the better side of each line, best edges first, a sensible cap per game
  const better = new Map<string, PlayerProp>();
  for (const p of props) {
    const k = `${p.stat}|${p.playerName}|${p.line}|${p.isAlt}`;
    if (!better.has(k) || p.edge > better.get(k)!.edge) better.set(k, p);
  }
  return [...better.values()].sort((a, b) => b.edge - a.edge);
}

function guessTeam(player: string, g: { homeRoster?: string[]; awayRoster?: string[] }): "home" | "away" | null {
  const n = player.toLowerCase().replace(/[^a-z ]/g, "");
  const has = (list?: string[]) => (list ?? []).some((x) => x.toLowerCase().replace(/[^a-z ]/g, "") === n);
  return has(g.homeRoster) ? "home" : has(g.awayRoster) ? "away" : null;
}
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
function poissonOver(lambda: number, line: number): number {
  const k = Math.floor(line) + 1;
  let term = Math.exp(-lambda), cdf = 0;
  for (let i = 0; i < k; i++) { cdf += term; term *= lambda / (i + 1); }
  return Math.max(0, 1 - cdf);
}
