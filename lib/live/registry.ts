/**
 * Game registry: every source adds games here, and the same game from different sources is merged
 * (matched by league + both teams + start date). Prices from every source collect on the game as quotes.
 */
import type { LeagueId, MarketOutcome, Matchup, OddsQuote } from "@/types/sports";
import { impliedProb } from "@/lib/odds-math";
import { dayKey } from "./day";

export interface Game {
  matchup: Matchup;
  sources: Set<string>;
  /** Source-specific ids and extras (ESPN event ids, team ids, probable pitchers, locations...). */
  espn?: { eventId: string; compId: string; homeTeamId: string; awayTeamId: string; homeAbbr?: string; awayAbbr?: string };
  homeLocation?: string;
  awayLocation?: string;
  venueCity?: string;
  probables?: { home?: { name: string; era?: number }; away?: { name: string; era?: number } };
  outcomes: Map<string, MarketOutcome>;
}

const SUFFIX2 = new Set(["sox", "jays", "knights", "wings", "leafs", "blazers", "city", "united", "fc", "sc"]);

/** Club tags that sources add or drop ("SC Paderborn 07" vs "Paderborn", "Malaga CF" vs "Malaga"). */
const CLUB_TAGS = new Set(["fc", "cf", "sc", "ac", "afc", "sv", "rc", "cd", "ud", "sd", "ssc", "ss", "as", "us", "club", "calcio", "de", "la", "the"]);
/** Same club, different language or nickname (whole names). */
const ALIASES: Record<string, string> = { "athletic bilbao": "athletic", "athletic club": "athletic", "man utd": "manchester united", "man united": "manchester united", "man city": "manchester city", spurs: "tottenham hotspur", psg: "paris saint germain", "paris sg": "paris saint germain", "inter milan": "internazionale", inter: "internazionale" };
/** Same word in another language, inside a longer name ("FC Koeln" / "FC Cologne"). */
const WORD_ALIASES: Record<string, string> = { koeln: "cologne", koln: "cologne", muenchen: "munich", munchen: "munich" };
/** Soccer names often end in the city, so a shared last word there doesn't mean the same club (Real / Atletico Madrid). */
const CITY_TAILS = new Set(["madrid", "milan", "milano", "paris", "rome", "roma", "munich", "london", "berlin", "lisbon", "glasgow", "turin", "genoa", "germain", "sevilla", "seville"]);

export function normTeam(name: string): string {
  const base = name.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ").replace(/&/g, "and").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const words = base.split(" ").filter((w) => !CLUB_TAGS.has(w) && !/^\d+$/.test(w));
  const out = (words.length ? words : base.split(" ")).join(" ");
  const words2 = out.split(" ").map((w) => WORD_ALIASES[w] ?? w).join(" ");
  return ALIASES[words2] ?? words2;
}
/** Nickname: last word, or last two for "Red Sox", "Maple Leafs", etc. */
export function nickname(name: string): string {
  const w = normTeam(name).split(" ");
  if (w.length >= 2 && SUFFIX2.has(w[w.length - 1])) return w.slice(-2).join(" ");
  return w[w.length - 1] ?? "";
}
/** Loose match across sources: full name, nickname, or one name containing the other ("Kansas City" vs "Kansas City Chiefs"). */
export function sameTeam(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = normTeam(a), nb = normTeam(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const nick = nickname(a);
  if (nick === nickname(b) && !CITY_TAILS.has(nick)) return true;
  // one name inside the other at the start or end: "Athletic" / "Athletic Bilbao", "Alaves" / "Deportivo Alaves"
  // (6+ letters, so a bare city like "Paris" doesn't swallow "Paris Saint-Germain")
  const inside = (x: string, y: string) => x.length >= 6 && (y.startsWith(x + " ") || y.endsWith(" " + x));
  return inside(na, nb) || inside(nb, na);
}

export class Registry {
  games: Game[] = [];

  find(league: LeagueId, home: string, away: string, startIso?: string): Game | undefined {
    const day = startIso ? dayKey(startIso) : undefined;
    const near = (g: Game, ms: number) => !startIso || Math.abs(new Date(g.matchup.startTime).getTime() - new Date(startIso).getTime()) < ms;
    return this.games.find((g) => g.matchup.league === league && sameTeam(g.matchup.home.name, home) && sameTeam(g.matchup.away.name, away) && (!day || near(g, 20 * 3600_000)))
      // a team can't play two games at once: same league, same kickoff, one team in common = the same game under other names
      ?? (startIso ? this.games.find((g) => g.matchup.league === league && near(g, 90 * 60_000)
        && (sameTeam(g.matchup.home.name, home) || sameTeam(g.matchup.away.name, away))) : undefined);
  }

  /** Add a game or merge into an existing one. Later sources fill gaps; final/live status always wins. */
  upsert(m: Matchup, source: string, extra: Partial<Omit<Game, "matchup" | "sources" | "outcomes">> = {}): Game {
    const ex = this.find(m.league, m.home.name, m.away.name, m.startTime);
    if (ex) {
      ex.sources.add(source);
      const rank = { scheduled: 0, postponed: 0, live: 1, final: 2 } as const;
      if (rank[m.status] > rank[ex.matchup.status]) ex.matchup.status = m.status;
      if (m.score && (!ex.matchup.score || rank[m.status] >= rank[ex.matchup.status])) ex.matchup.score = m.score;
      ex.matchup.venue ??= m.venue;
      ex.matchup.week ??= m.week;
      ex.matchup.home.logoUrl ??= m.home.logoUrl; ex.matchup.away.logoUrl ??= m.away.logoUrl;
      ex.matchup.home.color ??= m.home.color; ex.matchup.away.color ??= m.away.color;
      ex.matchup.home.record ??= m.home.record;
      ex.matchup.away.record ??= m.away.record;
      ex.matchup.home.abbreviation ??= m.home.abbreviation;
      ex.matchup.away.abbreviation ??= m.away.abbreviation;
      for (const [k, v] of Object.entries(extra)) if (v !== undefined && (ex as unknown as Record<string, unknown>)[k] === undefined) (ex as unknown as Record<string, unknown>)[k] = v;
      return ex;
    }
    const g: Game = { matchup: { ...m, id: m.id || `${m.league}-${normTeam(m.away.name)}-at-${normTeam(m.home.name)}-${dayKey(m.startTime)}`.replace(/\s+/g, "-") }, sources: new Set([source]), outcomes: new Map(), ...extra };
    this.games.push(g);
    return g;
  }

  /** Add one sportsbook (or exchange) price to a game's market. Same book twice keeps the newer price. */
  addQuote(g: Game, market: MarketOutcome["market"], side: MarketOutcome["side"], american: number | undefined, line: number | undefined, book: string) {
    if (american === undefined || !Number.isFinite(american) || (american > -100 && american < 100)) return;
    const m = g.matchup;
    const label = market === "moneyline"
      ? side === "draw" ? "Draw" : `${side === "home" ? m.home.shortName : m.away.shortName} ML`
      : market === "spread" ? `${side === "home" ? m.home.shortName : m.away.shortName} ${line! > 0 ? "+" : ""}${line}`
      : `${side === "over" ? "Over" : "Under"} ${line}`;
    const id = `${m.id}:${market}:${side}:${line ?? ""}`;
    const key = book.toLowerCase().replace(/\W+/g, "");
    const quote: OddsQuote = { bookmaker: { key, name: book }, americanOdds: Math.round(american), line, updatedAt: new Date().toISOString() };
    const ex = g.outcomes.get(id);
    if (!ex) { g.outcomes.set(id, { id, matchupId: m.id, market, side, label, line, quotes: [quote], best: quote }); return; }
    ex.quotes = ex.quotes.filter((q) => q.bookmaker.key !== key).concat(quote);
    ex.best = ex.quotes.reduce((a, b) => (impliedProb(b.americanOdds) < impliedProb(a.americanOdds) ? b : a));
  }
}
