/** Prediction-market prices (free, no key): Kalshi and Polymarket game-winner contracts, added as extra "books". */
import type { LeagueId } from "@/types/sports";
import { probToAmerican } from "@/lib/odds-math";
import { LEAGUES } from "@/lib/leagues";
import { getJson } from "../http";
import { sameTeam, type Registry } from "../registry";
type J = Record<string, any>;

const KALSHI_SERIES: Partial<Record<LeagueId, string>> = { NFL: "KXNFLGAME", NCAAF: "KXNCAAFGAME", NBA: "KXNBAGAME", MLB: "KXMLBGAME", NHL: "KXNHLGAME", EPL: "KXEPLGAME" };
const POLY_TAG: Partial<Record<LeagueId, string>> = { NFL: "nfl", NCAAF: "cfb", NBA: "nba", MLB: "mlb", NHL: "nhl", EPL: "epl", UCL: "ucl", MLS: "mls" };
const KALSHI_FEE = Number(process.env.KALSHI_FEE ?? 0.07);

/** Kalshi labels teams like "Chicago WS" or "New York Y": city plus an optional suffix of the nickname's initials. */
function kalshiMatch(label: string, full: string): boolean {
  if (sameTeam(label, full)) return true;
  const toks = label.replace(/^LA /, "Los Angeles ").split(/\s+/);
  for (let i = toks.length; i > 0; i--) {
    const city = toks.slice(0, i).join(" ").toLowerCase(), suffix = toks.slice(i).join("").toUpperCase();
    const f = full.toLowerCase();
    if (!f.startsWith(city + " ") && f !== city) continue;
    if (!suffix) return true;
    const nick = full.slice(city.length).trim().split(/\s+/);
    if (nick.map((w) => w[0]).join("").toUpperCase().startsWith(suffix) || nick.join("").toUpperCase().startsWith(suffix)) return true;
  }
  return false;
}

export async function kalshi(reg: Registry, league: LeagueId): Promise<number | null> {
  const series = KALSHI_SERIES[league];
  if (!series) return 0;
  const d = await getJson<J>("https://api.elections.kalshi.com/trade-api/v2/events", { series_ticker: series, status: "open", with_nested_markets: "true", limit: 200 });
  if (!d) return null;
  let priced = 0;
  for (const ev of d.events ?? []) {
    const mk: J[] = ev.markets ?? [];
    for (const g of reg.games.filter((x) => x.matchup.league === league && x.matchup.status === "scheduled")) {
      const home = mk.find((m) => kalshiMatch(m.yes_sub_title ?? "", g.matchup.home.name));
      const away = mk.find((m) => m !== home && kalshiMatch(m.yes_sub_title ?? "", g.matchup.away.name));
      if (!home || !away) continue;
      for (const [side, m] of [["home", home], ["away", away]] as const) {
        const ask = m.yes_ask_dollars !== undefined ? Number(m.yes_ask_dollars) : Number(m.yes_ask) / 100;
        if (!(ask > 0 && ask < 1)) continue;
        reg.addQuote(g, "moneyline", side, probToAmerican(ask + KALSHI_FEE * ask * (1 - ask)), undefined, "Kalshi");
        priced++;
      }
      break;
    }
  }
  return priced;
}

export async function polymarket(reg: Registry, league: LeagueId): Promise<number | null> {
  const tag = POLY_TAG[league];
  // soccer: Polymarket's two-outcome team markets aren't the three-way (win/draw/lose) moneyline
  if (!tag || LEAGUES[league].hasDraw) return 0;
  const d = await getJson<J[] | J>("https://gamma-api.polymarket.com/events", { tag_slug: tag, active: "true", closed: "false", limit: 200 });
  if (!d) return null;
  const events: J[] = Array.isArray(d) ? d : d.events ?? d.data ?? [];
  let priced = 0;
  for (const ev of events) for (const m of ev.markets ?? []) {
    let outcomes: string[] = [], prices: number[] = [];
    try {
      outcomes = typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : m.outcomes ?? [];
      prices = (typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices ?? []).map(Number);
    } catch { continue; }
    if (outcomes.length !== 2 || prices.length !== 2) continue;
    const g = reg.games.find((x) => x.matchup.league === league && x.matchup.status === "scheduled"
      && outcomes.some((o) => sameTeam(o, x.matchup.home.name)) && outcomes.some((o) => sameTeam(o, x.matchup.away.name)));
    if (!g) continue;
    outcomes.forEach((o, i) => {
      const side = sameTeam(o, g.matchup.home.name) ? "home" : "away";
      const p = prices[i] + 0.01;     // listed prices are mid; you pay about a cent more
      if (p > 0.02 && p < 0.98) { reg.addQuote(g, "moneyline", side, probToAmerican(p), undefined, "Polymarket"); priced++; }
    });
  }
  return priced;
}
