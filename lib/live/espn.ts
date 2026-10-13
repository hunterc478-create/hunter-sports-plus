/**
 * ESPN public feeds (free, no key). Unofficial, so every field is read defensively.
 * - scoreboard: games, status, scores, venue, team ids
 * - core odds: lines from several sportsbooks per game
 * - summary: injuries and each team's recent games (for rest days)
 * - team: season record and points for/against (for ratings)
 */
import type { Injury, InjuryStatus, LeagueId, MarketOutcome, Matchup, OddsQuote, TeamRatings } from "@/types/sports";
import { impliedProb } from "@/lib/odds-math";
import { getJson } from "./http";

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const CORE = "https://sports.core.api.espn.com/v2/sports";

export const ESPN_PATHS: Partial<Record<LeagueId, { path: string; groups?: string }>> = {
  NFL: { path: "football/nfl" },
  NCAAF: { path: "football/college-football", groups: "80" },
  NBA: { path: "basketball/nba" },
  NCAAB: { path: "basketball/mens-college-basketball", groups: "50" },
  MLB: { path: "baseball/mlb" },
  NHL: { path: "hockey/nhl" },
  EPL: { path: "soccer/eng.1" },
  MLS: { path: "soccer/usa.1" },
  UCL: { path: "soccer/uefa.champions" },
  LALIGA: { path: "soccer/esp.1" },
  SERIEA: { path: "soccer/ita.1" },
  BUNDESLIGA: { path: "soccer/ger.1" },
  LIGUE1: { path: "soccer/fra.1" },
  WNBA: { path: "basketball/wnba" },
  NCAAW: { path: "basketball/womens-college-basketball", groups: "50" },
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v as Json) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (s === "even" || s === "ev") return 100;
  const n = Number(s.replace(/^[ou]/, "").replace(",", ""));
  return Number.isFinite(n) ? n : undefined;
};
const price = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined || (n > -100 && n < 100) ? undefined : Math.round(n);
};
/** ESPN colors come as "002244"; "000000"/"ffffff" are placeholders, so they're dropped. */
const hex = (v: unknown): string | undefined => { const s = str(v); return s && /^[0-9a-f]{6}$/i.test(s) && !/^(000000|ffffff)$/i.test(s) ? `#${s}` : undefined; };
const dig = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((x, k) => obj(x)[k], o);

export interface EspnGame {
  matchup: Matchup;
  eventId: string;
  compId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeAbbr?: string;
  awayAbbr?: string;
  homeLocation?: string;
  awayLocation?: string;
  venueCity?: string;
  probables?: { home?: { name: string; era?: number }; away?: { name: string; era?: number } };
}

/** Games between two YYYYMMDD dates (inclusive). */
/** Which request style ESPN last accepted (shown in the Sources panel). */
export const espnVariant: { used?: string; down?: boolean } = {};

/**
 * ESPN has rejected some request styles with HTTP 400 from GitHub's servers, so try several and keep the first
 * that works: the range with and without extra options, the backup web host, then one day at a time.
 */
async function scoreboard(path: string, startYmd: string, endYmd: string, groups?: string): Promise<Json | null> {
  if (espnVariant.down) return null;   // ESPN refused every style earlier this run: don't hammer it league after league
  const hosts = [SITE, "https://site.web.api.espn.com/apis/site/v2/sports"];
  const tries: [string, Record<string, string | number | undefined>][] = [
    ["range", { dates: `${startYmd}-${endYmd}`, limit: 500, groups }],
    ["range, no limit", { dates: `${startYmd}-${endYmd}`, groups }],
    ["range, plain", { dates: `${startYmd}-${endYmd}` }],
  ];
  if (espnVariant.used?.startsWith("per day")) tries.length = 0;   // skip straight to what worked last time
  for (const host of hosts) for (const [label, params] of tries) {
    const d = await getJson<Json>(`${host}/${path}/scoreboard`, params);
    if (d) { espnVariant.used = `${label}${host === SITE ? "" : " (web host)"}`; return d; }
  }
  // one day at a time, merged
  const events: unknown[] = [];
  let any = false;
  for (let d = startYmd; d <= endYmd; d = nextYmd(d)) {
    for (const host of hosts) {
      const day = await getJson<Json>(`${host}/${path}/scoreboard`, groups ? { dates: d, groups } : { dates: d });
      if (day) { any = true; events.push(...arr(day.events)); espnVariant.used = `per day${host === SITE ? "" : " (web host)"}`; break; }
    }
    if (!any && d > startYmd) break;   // first two days both refused: stop hammering
  }
  if (!any && !espnVariant.used) espnVariant.down = true;
  return any ? { events } : null;
}

function nextYmd(ymd: string): string {
  const dt = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6) + 1));
  return dt.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function getGames(league: LeagueId, startYmd: string, endYmd: string): Promise<EspnGame[] | null> {
  const cfg = ESPN_PATHS[league];
  if (!cfg) return [];
  const data = await scoreboard(cfg.path, startYmd, endYmd, cfg.groups);
  if (!data) return null;
  const out: EspnGame[] = [];
  for (const e of arr(data.events).map(obj)) {
    const comp = obj(arr(e.competitions)[0]);
    const cs = arr(comp.competitors).map(obj);
    const home = cs.find((c) => c.homeAway === "home");
    const away = cs.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    const stComp = obj(dig(comp, "status", "type"));
    const st = Object.keys(stComp).length ? stComp : obj(dig(e, "status", "type"));
    const state = str(st.state) ?? "pre";
    const status: Matchup["status"] = st.completed === true || state === "post" ? "final" : state === "in" ? "live" : "scheduled";
    const team = (c: Json) => obj(c.team);
    const record = (c: Json) => str(obj(arr(c.records)[0]).summary);
    const id = `${league}-${str(e.id)}`;
    const venue = obj(comp.venue);
    const scoreOf = (c: Json) => num(c.score);
    const matchup: Matchup = {
      id,
      league,
      startTime: str(e.date) ?? new Date().toISOString(),
      status,
      week: num(dig(e, "week", "number")),
      home: { id: str(team(home).id) ?? "home", name: str(team(home).displayName) ?? "Home", shortName: str(team(home).shortDisplayName) ?? str(team(home).name) ?? "Home", abbreviation: str(team(home).abbreviation), record: record(home), logoUrl: str(team(home).logo), color: hex(team(home).color) },
      away: { id: str(team(away).id) ?? "away", name: str(team(away).displayName) ?? "Away", shortName: str(team(away).shortDisplayName) ?? str(team(away).name) ?? "Away", abbreviation: str(team(away).abbreviation), record: record(away), logoUrl: str(team(away).logo), color: hex(team(away).color) },
      venue: venue.fullName ? { name: str(venue.fullName)!, city: str(dig(venue, "address", "city")) ?? "", indoor: venue.indoor === true } : undefined,
      neutralSite: comp.neutralSite === true,
      score: status !== "scheduled" && scoreOf(home) !== undefined ? { home: scoreOf(home)!, away: scoreOf(away) ?? 0, clock: str(st.shortDetail) } : undefined,
    };
    const probable = (c: Json) => {
      const p = obj(arr(c.probables)[0]);
      const name = str(dig(p, "athlete", "displayName"));
      if (!name) return undefined;
      const era = arr(p.statistics).map(obj).find((s) => String(s.abbreviation ?? s.name).toUpperCase() === "ERA");
      return { name, era: num(era?.displayValue ?? era?.value) };
    };
    out.push({
      matchup, eventId: str(e.id)!, compId: str(comp.id) ?? str(e.id)!,
      homeTeamId: matchup.home.id, awayTeamId: matchup.away.id,
      homeAbbr: matchup.home.abbreviation, awayAbbr: matchup.away.abbreviation,
      homeLocation: str(team(home).location), awayLocation: str(team(away).location),
      venueCity: matchup.venue?.city,
      probables: league === "MLB" ? { home: probable(home), away: probable(away) } : undefined,
    });
  }
  return out;
}

/** Moneyline / spread / total from every sportsbook ESPN lists for the game, merged into MarketOutcomes. */
/** `closing`: for games already under way, read each book's closing (last pregame) line rather than a live one. */
export async function getOdds(league: LeagueId, g: EspnGame, hasDraw: boolean, closing = false): Promise<MarketOutcome[]> {
  const cfg = ESPN_PATHS[league];
  if (!cfg) return [];
  const [sport, lg] = cfg.path.split("/");
  const data = await getJson<Json>(`${CORE}/${sport}/leagues/${lg}/events/${g.eventId}/competitions/${g.compId}/odds`, { limit: 50 });
  const items: Json[] = [];
  for (const raw of arr(data?.items).map(obj)) {
    if (Object.keys(raw).length === 1 && raw.$ref) {
      const full = await getJson<Json>(String(raw.$ref));
      if (full) items.push(full);
    } else items.push(raw);
  }
  const m = g.matchup;
  const map = new Map<string, MarketOutcome>();
  const add = (market: MarketOutcome["market"], side: MarketOutcome["side"], label: string, american: number | undefined, line: number | undefined, book: string) => {
    if (american === undefined) return;
    const id = `${m.id}:${market}:${side}:${line ?? ""}`;
    const quote: OddsQuote = { bookmaker: { key: book.toLowerCase().replace(/\W+/g, ""), name: book }, americanOdds: american, line, updatedAt: new Date().toISOString() };
    const ex = map.get(id);
    if (!ex) map.set(id, { id, matchupId: m.id, market, side, label, line, quotes: [quote], best: quote });
    else if (!ex.quotes.some((q) => q.bookmaker.key === quote.bookmaker.key)) {
      ex.quotes.push(quote);
      if (impliedProb(american) < impliedProb(ex.best.americanOdds)) ex.best = quote;
    }
  };
  for (const it of items) {
    const book = str(dig(it, "provider", "name")) ?? "Sportsbook";
    if (/live|consensus|projection|numberfire|teamrankings/i.test(book)) continue;
    const H = obj(it.homeTeamOdds), A = obj(it.awayTeamOdds);
    // the top-level fields are the book's current number; for a game under way that's a live line, so use the close
    const order = closing ? ["close", "current", "open"] : ["current", "close", "open"];
    const cur = (p: string[], f = "odds") => order.map((k) => dig(it, ...p, k, f)).find((v) => v !== undefined);
    const top = <T,>(v: T) => (closing ? undefined : v);
    add("moneyline", "home", `${m.home.shortName} ML`, price(top(H.moneyLine) ?? cur(["moneyline", "home"]) ?? H.moneyLine), undefined, book);
    add("moneyline", "away", `${m.away.shortName} ML`, price(top(A.moneyLine) ?? cur(["moneyline", "away"]) ?? A.moneyLine), undefined, book);
    if (hasDraw) add("moneyline", "draw", "Draw", price(top(dig(it, "drawOdds", "moneyLine")) ?? cur(["moneyline", "draw"]) ?? dig(it, "drawOdds", "moneyLine")), undefined, book);

    // spread, stored from the home team's side
    let homeLine = num(cur(["pointSpread", "home"], "line"));
    const spreadAbs = num(it.spread);
    if (homeLine === undefined && spreadAbs !== undefined) {
      const s = Math.abs(spreadAbs);
      const det = str(it.details) ?? "";
      if (H.favorite === true || (g.homeAbbr && det.startsWith(g.homeAbbr + " "))) homeLine = -s;
      else if (A.favorite === true || (g.awayAbbr && det.startsWith(g.awayAbbr + " "))) homeLine = s;
    }
    if (homeLine !== undefined && homeLine !== 0) {
      const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);
      add("spread", "home", `${m.home.shortName} ${fmt(homeLine)}`, price(top(H.spreadOdds) ?? cur(["pointSpread", "home"]) ?? H.spreadOdds), homeLine, book);
      add("spread", "away", `${m.away.shortName} ${fmt(-homeLine)}`, price(top(A.spreadOdds) ?? cur(["pointSpread", "away"]) ?? A.spreadOdds), -homeLine, book);
    }
    const total = num(top(it.overUnder) ?? cur(["total", "over"], "line") ?? it.overUnder);
    if (total) {
      add("total", "over", `Over ${total}`, price(top(it.overOdds) ?? cur(["total", "over"]) ?? it.overOdds), total, book);
      add("total", "under", `Under ${total}`, price(top(it.underOdds) ?? cur(["total", "under"]) ?? it.underOdds), total, book);
    }
  }
  return [...map.values()];
}

/** How much an absent player is worth, in the sport's units (points/goals/runs). */
const POS_IMPACT: Record<string, Record<string, number>> = {
  football: { QB: 4, RB: 0.4, WR: 0.6, TE: 0.4, OT: 0.7, T: 0.7, G: 0.5, OG: 0.5, C: 0.6, OL: 0.6, DE: 0.6, EDGE: 0.6, DT: 0.5, DL: 0.5, NT: 0.4, LB: 0.4, OLB: 0.5, ILB: 0.4, MLB: 0.4, CB: 0.6, S: 0.4, FS: 0.4, SS: 0.4, K: 0.4, PK: 0.4, "*": 0.15 },
  basketball: { "*": 1.0 },
  baseball: { SP: 0, RP: 0.03, P: 0.03, "*": 0.06 },
  hockey: { G: 0.3, "*": 0.05 },
  soccer: { GK: 0.15, G: 0.15, "*": 0.06 },
};
const STATUS_MAP: [RegExp, InjuryStatus][] = [
  [/out|reserve|\bir\b|suspen/i, "out"], [/doubt/i, "doubtful"], [/question/i, "questionable"], [/day[- ]to[- ]day/i, "day_to_day"], [/probable/i, "probable"],
];

export interface GameSummary {
  injuries: { home: Injury[]; away: Injury[] };
  lastGame: { home?: string; away?: string };
}

export async function getSummary(league: LeagueId, sportKey: string, g: EspnGame): Promise<GameSummary> {
  const cfg = ESPN_PATHS[league]!;
  const data = await getJson<Json>(`${SITE}/${cfg.path}/summary`, { event: g.eventId });
  const weights = POS_IMPACT[sportKey] ?? { "*": 0.2 };
  const injuriesFor = (teamId: string): Injury[] => {
    const out: Injury[] = [];
    for (const blk of arr(data?.injuries).map(obj)) {
      if (str(dig(blk, "team", "id")) !== teamId) continue;
      for (const inj of arr(blk.injuries).map(obj)) {
        const rawStatus = inj.status;
        const statusText = str(rawStatus) ?? str(obj(rawStatus).name) ?? str(obj(rawStatus).description) ?? str(dig(inj, "type", "description")) ?? "";
        const status = STATUS_MAP.find(([re]) => re.test(statusText))?.[1];
        if (!status) continue;
        const pos = (str(dig(inj, "athlete", "position", "abbreviation")) ?? "").toUpperCase();
        const name = str(dig(inj, "athlete", "displayName")) ?? "Player";
        out.push({ playerId: name.toLowerCase().replace(/\W+/g, "-"), playerName: name, position: pos || "—", status, impact: weights[pos] ?? weights["*"] ?? 0.2, note: str(inj.details) });
      }
    }
    return out;
  };
  const lastFor = (teamId: string): string | undefined => {
    let best: string | undefined;
    for (const blk of arr(data?.lastFiveGames).map(obj)) {
      if (str(dig(blk, "team", "id")) !== teamId) continue;
      for (const ev of arr(blk.events).map(obj)) {
        const d = str(ev.gameDate) ?? str(ev.date);
        if (d && new Date(d) < new Date(g.matchup.startTime) && (!best || d > best)) best = d;
      }
    }
    return best;
  };
  return {
    injuries: { home: injuriesFor(g.homeTeamId), away: injuriesFor(g.awayTeamId) },
    lastGame: { home: lastFor(g.homeTeamId), away: lastFor(g.awayTeamId) },
  };
}

const teamCache = new Map<string, Promise<TeamRatings | null>>();

/**
 * Ratings from season scoring: power = per-game scoring margin vs average (expected margin = powerH - powerA),
 * offense/defense = points for/against relative to half the league-average total.
 */
export function getTeamRatings(league: LeagueId, teamId: string, avgTotal: number): Promise<TeamRatings | null> {
  const key = `${league}:${teamId}`;
  if (!teamCache.has(key)) {
    teamCache.set(key, (async () => {
      const cfg = ESPN_PATHS[league];
      if (!cfg) return null;
      const data = await getJson<Json>(`${SITE}/${cfg.path}/teams/${teamId}`);
      const items = arr(dig(data, "team", "record", "items")).map(obj);
      const total = items.find((i) => i.type === "total") ?? items[0];
      if (!total) return null;
      const st = Object.fromEntries(arr(total.stats).map(obj).map((s) => [str(s.name) ?? "", num(s.value)]));
      const gp = st.gamesPlayed ?? (st.wins ?? 0) + (st.losses ?? 0) + (st.ties ?? 0) + (st.OTLosses ?? 0);
      let pf = st.avgPointsFor, pa = st.avgPointsAgainst;
      if ((pf === undefined || pa === undefined) && gp && st.pointsFor !== undefined && st.pointsAgainst !== undefined) {
        pf = st.pointsFor / gp;
        pa = st.pointsAgainst / gp;
      }
      if (pf === undefined || pa === undefined || !gp) return { powerRating: 0, sampleSize: 0 };
      return { powerRating: pf - pa, offense: pf - avgTotal / 2, defense: avgTotal / 2 - pa, sampleSize: gp };
    })());
  }
  return teamCache.get(key)!;
}

const rosterCache = new Map<string, Promise<string[]>>();
/** Player names on a team's roster (used to tie player props to a team). */
export function getRosterNames(league: LeagueId, teamId: string): Promise<string[]> {
  const key = `${league}:${teamId}`;
  if (!rosterCache.has(key)) {
    rosterCache.set(key, (async () => {
      const cfg = ESPN_PATHS[league];
      if (!cfg) return [];
      const data = await getJson<Json>(`${SITE}/${cfg.path}/teams/${teamId}/roster`);
      const names: string[] = [];
      const visit = (v: unknown) => {
        for (const a of arr(v).map(obj)) {
          if (a.items) visit(a.items);
          const n = str(a.displayName) ?? str(a.fullName);
          if (n) names.push(n);
        }
      };
      visit(data?.athletes);
      return names;
    })());
  }
  return rosterCache.get(key)!;
}
