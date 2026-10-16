/**
 * The Odds API as a *backup* for game lines (it costs credits: markets x regions per call).
 * Only used for leagues where the free sources left upcoming games without prices, and only at LINES_HOURS.
 * Region us2 includes Fliff.
 */
import type { LeagueId } from "@/types/sports";
import { ODDS_API_KEYS } from "@/lib/leagues";
import { getJson } from "../http";
import type { Registry } from "../registry";
import { sameTeam } from "../registry";

type Ev = { home_team: string; away_team: string; commence_time: string; bookmakers: { title: string; markets: { key: string; outcomes: { name: string; price: number; point?: number }[] }[] }[] };

export async function oddsApiLines(reg: Registry, league: LeagueId): Promise<number | null> {
  const key = process.env.THE_ODDS_API_KEY;
  const sport = ODDS_API_KEYS[league];
  if (!key || !sport) return null;
  const data = await getJson<Ev[]>(`https://api.the-odds-api.com/v4/sports/${sport}/odds`, {
    apiKey: key, regions: process.env.ODDS_REGIONS ?? "us", markets: "h2h,spreads,totals", oddsFormat: "american",
  });
  if (!data) return null;
  let n = 0;
  for (const ev of data) {
    const g = reg.find(league, ev.home_team, ev.away_team, ev.commence_time);
    if (!g || g.matchup.status !== "scheduled") continue;
    for (const bk of ev.bookmakers) for (const m of bk.markets) for (const o of m.outcomes) {
      const side = sameTeam(o.name, ev.home_team) ? "home" : sameTeam(o.name, ev.away_team) ? "away" : o.name === "Draw" ? "draw" : o.name === "Over" ? "over" : "under";
      if (m.key === "h2h") reg.addQuote(g, "moneyline", side, o.price, undefined, bk.title);
      else if (m.key === "spreads") reg.addQuote(g, "spread", side, o.price, o.point, bk.title);
      else if (m.key === "totals") reg.addQuote(g, "total", side, o.price, o.point, bk.title);
    }
    n++;
  }
  return n;
}
