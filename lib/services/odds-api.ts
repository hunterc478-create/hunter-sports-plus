/**
 * The Odds API adapter (https://the-odds-api.com, v4).
 * Normalizes events into Matchup + MarketOutcome[] and caches each pull.
 * Every request costs credits (markets x regions), so all reads go through the cache.
 */
import type { LeagueId, MarketOutcome, Matchup, OddsQuote, OddsSnapshot } from "@/types/sports";
import { ODDS_API_KEYS } from "@/lib/leagues";
import { cached } from "@/lib/cache";
import { impliedProb } from "@/lib/odds-math";

const BASE = "https://api.the-odds-api.com/v4";
const TTL = Number(process.env.ODDS_CACHE_TTL_SECONDS ?? 40);

export class OddsApiError extends Error {
  constructor(message: string, public status?: number, public remaining?: string | null) {
    super(message);
  }
}

interface RawOutcome { name: string; price: number; point?: number; description?: string }
interface RawMarket { key: string; last_update: string; outcomes: RawOutcome[] }
interface RawBookmaker { key: string; title: string; markets: RawMarket[] }
interface RawEvent { id: string; sport_key: string; commence_time: string; home_team: string; away_team: string; bookmakers: RawBookmaker[] }

async function request<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.THE_ODDS_API_KEY;
  if (!key) throw new OddsApiError("THE_ODDS_API_KEY is not set");
  const qs = new URLSearchParams({ ...params, apiKey: key });
  const res = await fetch(`${BASE}${path}?${qs}`, { cache: "no-store" });
  const remaining = res.headers.get("x-requests-remaining");
  if (!res.ok) throw new OddsApiError(`Odds API ${res.status}: ${await res.text()}`, res.status, remaining);
  return (await res.json()) as T;
}

/** Fetch moneyline/spread/total for a league; cached for ODDS_CACHE_TTL_SECONDS. */
export async function getLeagueOdds(league: LeagueId, markets = "h2h,spreads,totals"): Promise<{ matchup: Matchup; snapshot: OddsSnapshot }[]> {
  const sport = ODDS_API_KEYS[league];
  if (!sport) return [];
  return cached(`odds:${league}:${markets}`, TTL, async () => {
    const events = await request<RawEvent[]>(`/sports/${sport}/odds`, {
      regions: process.env.ODDS_REGIONS ?? "us",
      markets,
      oddsFormat: "american",
      bookmakers: process.env.ODDS_BOOKMAKERS ?? "",
    });
    return events.map((e) => normalizeEvent(e, league));
  });
}

/** Player props for a single event (costs 1 credit per market per region). */
export async function getEventProps(league: LeagueId, eventId: string, markets: string[]): Promise<RawEvent> {
  const sport = ODDS_API_KEYS[league];
  if (!sport) throw new OddsApiError(`No Odds API key mapped for ${league}`);
  return cached(`props:${eventId}:${markets.join(",")}`, TTL * 3, () =>
    request<RawEvent>(`/sports/${sport}/events/${eventId}/odds`, { regions: process.env.ODDS_REGIONS ?? "us", markets: markets.join(","), oddsFormat: "american" }),
  );
}

function normalizeEvent(e: RawEvent, league: LeagueId): { matchup: Matchup; snapshot: OddsSnapshot } {
  const matchup: Matchup = {
    id: e.id, league, startTime: e.commence_time, status: new Date(e.commence_time) < new Date() ? "live" : "scheduled",
    home: { id: slug(e.home_team), name: e.home_team, shortName: short(e.home_team) },
    away: { id: slug(e.away_team), name: e.away_team, shortName: short(e.away_team) },
  };
  const map = new Map<string, MarketOutcome>();
  for (const bk of e.bookmakers) {
    for (const m of bk.markets) {
      const market = m.key === "h2h" ? "moneyline" : m.key === "spreads" ? "spread" : m.key === "totals" ? "total" : null;
      if (!market) continue;
      for (const o of m.outcomes) {
        const side = o.name === e.home_team ? "home" : o.name === e.away_team ? "away" : o.name === "Draw" ? "draw" : o.name === "Over" ? "over" : "under";
        const id = `${e.id}:${market}:${side}:${o.point ?? ""}`;
        const quote: OddsQuote = { bookmaker: { key: bk.key, name: bk.title }, americanOdds: o.price, line: o.point, updatedAt: m.last_update };
        const label = market === "moneyline" ? `${side === "draw" ? "Draw" : o.name} ML` : market === "spread" ? `${short(o.name)} ${fmtLine(o.point)}` : `${o.name} ${o.point}`;
        const existing = map.get(id);
        if (!existing) map.set(id, { id, matchupId: e.id, market, side, label, line: o.point, quotes: [quote], best: quote });
        else {
          existing.quotes.push(quote);
          if (impliedProb(quote.americanOdds) < impliedProb(existing.best.americanOdds)) existing.best = quote;
        }
      }
    }
  }
  return { matchup, snapshot: { matchupId: e.id, fetchedAt: new Date().toISOString(), outcomes: [...map.values()] } };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const short = (s: string) => s.split(" ").slice(-1)[0];
const fmtLine = (p?: number) => (p == null ? "" : p > 0 ? `+${p}` : `${p}`);
