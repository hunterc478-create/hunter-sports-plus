/**
 * Tennis (ATP / WTA singles).
 *   Matches + results: ESPN's tennis scoreboard (free): every singles match of the tournaments being played.
 *   Rankings: ESPN's ATP / WTA rankings (top 150 with points).
 *   Prices: The Odds API (tennis is tournament-keyed there and nothing free carries sportsbook tennis lines). Pulled
 *           at LINES_HOURS only, about 2 credits a call, and cached in public/data/tennis-odds.json between runs.
 *   Our chance: ranking points (a 3,000-point player vs a 1,000-point player wins about 72%), nudged by how each
 *   player is doing this week in the tournament.
 */
import fs from "node:fs";
import path from "node:path";
import type { FactorTrigger, LeagueId, Matchup, Prediction } from "@/types/sports";
import { getJson } from "../http";
import type { Registry } from "../registry";

type Json = Record<string, unknown>;
const o = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
/** "Botic van de Zandschulp" and "Botic Van De Zandschulp" are one player. */
export const pname = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const samePlayer = (x: string, y: string) => {
  const A = pname(x), B = pname(y);
  if (A === B) return true;
  const [af, ...al] = A.split(" "), [bf, ...bl] = B.split(" ");
  return al.join(" ") === bl.join(" ") && !!af && !!bf && af[0] === bf[0];
};

const TOUR: Record<"ATP" | "WTA", { espn: string; singles: RegExp; odds: string }> = {
  ATP: { espn: "atp", singles: /men's singles/i, odds: "tennis_atp_" },
  WTA: { espn: "wta", singles: /women's singles/i, odds: "tennis_wta_" },
};

export interface TennisContext {
  ranks: Map<string, { rank: number; points: number }>;
  /** wins this tournament and the round each player is in */
  form: Map<string, { wins: number; event: string; round: string }>;
}
export const tennisCtx: Partial<Record<LeagueId, TennisContext>> = {};

const CACHE = path.join("public", "data", "tennis-odds.json");
type CachedEv = { league: LeagueId; home: string; away: string; commence: string; quotes: { side: "home" | "away"; price: number; book: string }[] };
type Cache = { fetchedAt?: string; events: CachedEv[] };
/**
 * The cached prices: this run's file if a refresh just wrote it, else the copy published with the site (each run
 * starts from a fresh checkout). Written back either way so the next deploy publishes it again.
 */
async function readCache(): Promise<Cache> {
  let c: Cache | null = null;
  try { c = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch { /* not refreshed this run */ }
  if (!c && process.env.SITE_URL) c = await getJson<Cache>(`${process.env.SITE_URL.replace(/\/$/, "")}/data/tennis-odds.json`);
  c = c && Array.isArray(c.events) ? c : { events: [] };
  try { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify(c)); } catch { /* read-only checkout */ }
  return c;
}
let cachePromise: Promise<Cache> | null = null;

/** Pull fresh tennis odds for both tours into the cache (only called at LINES_HOURS). */
export async function refreshTennisOdds(leagues: LeagueId[]): Promise<number | null> {
  const key = process.env.THE_ODDS_API_KEY;
  if (!key) return null;
  const sports = await getJson<{ key: string; active: boolean }[]>("https://api.the-odds-api.com/v4/sports", { apiKey: key });   // free call
  if (!sports) return null;
  const events: CachedEv[] = [];
  for (const lg of leagues.filter((l): l is "ATP" | "WTA" => l === "ATP" || l === "WTA")) {
    for (const sp of sports.filter((x) => x.active && x.key.startsWith(TOUR[lg].odds))) {
      const data = await getJson<{ home_team: string; away_team: string; commence_time: string; bookmakers: { title: string; markets: { key: string; outcomes: { name: string; price: number }[] }[] }[] }[]>(
        `https://api.the-odds-api.com/v4/sports/${sp.key}/odds`, { apiKey: key, regions: "us", markets: "h2h", oddsFormat: "american" });   // one region = 1 credit per tournament
      for (const ev of data ?? []) {
        const quotes: CachedEv["quotes"] = [];
        for (const bk of ev.bookmakers) for (const m of bk.markets) if (m.key === "h2h") for (const q of m.outcomes)
          quotes.push({ side: samePlayer(q.name, ev.home_team) ? "home" : "away", price: q.price, book: bk.title });
        if (quotes.length) events.push({ league: lg, home: ev.home_team, away: ev.away_team, commence: ev.commence_time, quotes });
      }
    }
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify({ fetchedAt: new Date().toISOString(), events }));
  return events.length;
}

/** Load the tour's matches into the registry, attach cached prices, and keep rankings + form for the model. */
export async function tennisGames(reg: Registry, lg: "ATP" | "WTA", now: Date): Promise<{ games: number; priced: number; oddsAt?: string } | null> {
  const t = TOUR[lg];
  const [board, rk] = await Promise.all([
    getJson<Json>(`https://site.api.espn.com/apis/site/v2/sports/tennis/${t.espn}/scoreboard`),
    getJson<Json>(`https://site.api.espn.com/apis/site/v2/sports/tennis/${t.espn}/rankings`),
  ]);
  if (!board) return null;
  const ranks = new Map<string, { rank: number; points: number }>();
  for (const r of a(o(a(o(rk).rankings)[0]).ranks)) {
    const x = o(r); const name = s(o(x.athlete).displayName);
    if (name) ranks.set(pname(name), { rank: Number(x.current) || 0, points: Number(x.points) || 0 });
  }
  const form = new Map<string, { wins: number; event: string; round: string }>();
  const cache = await (cachePromise ??= readCache());
  const fresh = cache.events.filter((e) => e.league === lg && new Date(e.commence).getTime() > now.getTime() - 8 * 3600_000);
  let games = 0, priced = 0;
  const added: { g: ReturnType<Registry["upsert"]>; comp: Json; names: [string, string] }[] = [];
  for (const ev of a(o(board).events)) {
    const event = o(ev);
    for (const grp of a(event.groupings)) {
      const gg = o(grp);
      if (!t.singles.test(s(o(gg.grouping).displayName))) continue;
      for (const c of a(gg.competitions)) {
        const comp = o(c);
        const cs = a(comp.competitors).map(o);
        if (cs.length !== 2) continue;
        const names = cs.map((x) => s(o(x.athlete).displayName)) as [string, string];
        if (names.some((n) => !n || /tbd|bye/i.test(n))) continue;
        const state = s(o(o(comp.status).type).state);
        const round = s(o(comp.round).displayName);
        // this week's wins and the round each player has reached
        cs.forEach((x, i) => {
          const k = pname(names[i]);
          const f = form.get(k) ?? { wins: 0, event: s(event.name), round };
          if (state === "post" && x.winner === true) f.wins++;
          f.round = round || f.round;
          form.set(k, f);
        });
        const sets = cs.map((x) => a(x.linescores).map((l) => Number(o(l).value) || 0));
        const won = [0, 1].map((i) => sets[i].filter((v, j) => v > (sets[1 - i][j] ?? 0)).length);
        const odds = fresh.find((e) => (samePlayer(e.home, names[0]) && samePlayer(e.away, names[1])) || (samePlayer(e.home, names[1]) && samePlayer(e.away, names[0])));
        const comp2: Matchup = {
          id: `${lg}-${s(comp.id)}`, league: lg, startTime: odds?.commence ?? s(comp.date), status: state === "post" ? "final" : state === "in" ? "live" : "scheduled",
          home: player(cs[0], names[0]), away: player(cs[1], names[1]),
          venue: { name: s(event.name), city: s(o(comp.venue).fullName), indoor: false }, neutralSite: true,
          score: state === "pre" ? undefined : { home: won[0], away: won[1] },
        };
        const g = reg.upsert(comp2, "ESPN");
        g.matchup.status = comp2.status; g.matchup.score = comp2.score; g.matchup.startTime = comp2.startTime;
        games++;
        added.push({ g, comp, names });
        if (odds && comp2.status === "scheduled") {
          const flip = !samePlayer(odds.home, names[0]);
          for (const q of odds.quotes) reg.addQuote(g, "moneyline", flip ? (q.side === "home" ? "away" : "home") : q.side, q.price, undefined, q.book);
          priced++;
        }
      }
    }
  }
  tennisCtx[lg] = { ranks, form };
  return { games, priced, oddsAt: cache.fetchedAt };
}

function player(x: Json, name: string) {
  const ath = o(x.athlete);
  const last = name.split(" ").slice(1).join(" ") || name;
  return { id: s(x.id) || name, name, shortName: last, abbreviation: last.slice(0, 3).toUpperCase(), logoUrl: s(o(ath.flag).href) || undefined };
}

/** Points for a player outside the top 150 (roughly where #200 sits). */
const UNRANKED = 350;

/** Our chance in a tennis match: ranking points, then a small nudge for this week's form. */
export function tennisPrediction(m: Matchup, now: Date): Prediction {
  const ctx = tennisCtx[m.league] ?? { ranks: new Map(), form: new Map() };
  const H = m.home.shortName, A = m.away.shortName;
  const rh = ctx.ranks.get(pname(m.home.name)), ra = ctx.ranks.get(pname(m.away.name));
  const ph = rh?.points || UNRANKED, pa = ra?.points || UNRANKED;
  const k = 0.85;
  const pRank = ph ** k / (ph ** k + pa ** k);
  const fh = ctx.form.get(pname(m.home.name)), fa = ctx.form.get(pname(m.away.name));
  const formAdj = Math.max(-0.05, Math.min(0.05, 0.015 * ((fh?.wins ?? 0) - (fa?.wins ?? 0))));
  const p = Math.max(0.03, Math.min(0.97, pRank + formAdj));
  const rankTxt = (n: string, r?: { rank: number; points: number }) => (r ? `${n} #${r.rank} (${r.points.toLocaleString("en-US")} pts)` : `${n} unranked (outside the top 150)`);
  const triggers: FactorTrigger[] = [
    { category: "ratings", label: "Ranking", detail: `${rankTxt(H, rh)} vs ${rankTxt(A, ra)}: ${Math.round(pRank * 100)}% for ${H} on points alone`, marginImpact: (pRank - 0.5) * 10, severity: "medium" },
  ];
  if (fh || fa) triggers.push({ category: "rest", label: "This week", detail: `${H} ${fh?.wins ?? 0} win${(fh?.wins ?? 0) === 1 ? "" : "s"} this tournament, ${A} ${fa?.wins ?? 0}${fh?.round ? ` (now in ${fh.round})` : ""}`, marginImpact: formAdj * 10, severity: "low" });
  if (m.venue?.name) triggers.push({ category: "venue", label: "Event", detail: `${m.venue.name}${m.venue.city ? `, ${m.venue.city}` : ""}`, marginImpact: 0, severity: "low" });
  return {
    matchupId: m.id, generatedAt: now.toISOString(), modelVersion: "tennis-rank-v1",
    homeWinProb: p, awayWinProb: 1 - p, projectedScore: { home: p, away: 1 - p }, projectedMargin: (p - 0.5) * 10, projectedTotal: 0,
    confidence: rh && ra ? 0.6 : 0.4, confidenceTier: rh && ra ? "medium" : "low", triggers,
  };
}
