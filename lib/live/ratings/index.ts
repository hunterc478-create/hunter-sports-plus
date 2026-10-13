/**
 * Advanced team ratings from free sources, keyed by full team name.
 * Every rating is expressed the way the engine wants it: powerRating = expected per-game margin
 * vs an average team (so a matchup's expected margin is powerRating(home) - powerRating(away)), offense/defense = points (or goals/runs) above average, sampleSize = games.
 */
import { execFile } from "node:child_process";
import zlib from "node:zlib";
import type { TeamRatings } from "@/types/sports";
import { getJson } from "../http";
import { sameTeam } from "../registry";
type J = Record<string, any>;

export type RatingTable = { source: string; teams: { name: string; abbr?: string; r: TeamRatings }[] };

/** Names that differ between sources (mostly college). Keys and values are normalized forms. */
const ALIASES: Record<string, string> = {
  "appalachian state": "app state", "florida international": "fiu", "louisiana monroe": "ul monroe", "louisiana lafayette": "louisiana",
  "southern mississippi": "southern miss", "massachusetts": "umass", "connecticut": "uconn", "hawaii": "hawai i", "hawai i": "hawai i",
  "miami fl": "miami", "san jose state": "san jos state", "texas a and m": "texas a m", "ole miss": "ole miss", "mississippi": "ole miss",
  "nc state": "nc state", "north carolina state": "nc state", "la tech": "louisiana tech", "ul lafayette": "louisiana", "sam houston state": "sam houston",
};
/** Keep words inside parentheses ("Miami (OH)" -> "miami oh") so different schools stay different. */
const keyName = (s: string) => {
  const n = s.toLowerCase().replace(/[()'.]/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return ALIASES[n] ?? n;
};

export function lookup(table: RatingTable | null, name: string, abbr?: string): TeamRatings | undefined {
  if (!table) return undefined;
  if (abbr) {
    const byAbbr = table.teams.find((t) => t.abbr && t.abbr.toUpperCase() === abbr.toUpperCase());
    if (byAbbr) return byAbbr.r;
  }
  const full = keyName(name);
  const exact = table.teams.find((t) => keyName(t.name) === full);
  if (exact) return exact.r;
  // "BYU Cougars" -> "BYU": the longest table name that the full name starts with wins ("Miami (OH)" beats "Miami")
  let best: { len: number; r: TeamRatings } | undefined;
  for (const t of table.teams) {
    const k = keyName(t.name);
    if (k.length >= 3 && (full.startsWith(k + " ") || ALIASES[full.split(" ").slice(0, -1).join(" ")] === k) && (!best || k.length > best.len)) best = { len: k.length, r: t.r };
  }
  if (best) return best.r;
  return table.teams.find((t) => sameTeam(t.name, name))?.r;
}

/** Season the sport is in for a given date (football/basketball/hockey seasons start in the fall). */
export const seasonYear = (d: Date, fallStart: boolean) => (fallStart && d.getUTCMonth() < 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear());

function download(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile("curl", ["-sS", "-L", "--fail", "--max-time", "120", url], { encoding: "buffer", maxBuffer: 400 * 1024 * 1024 }, (err, out) => resolve(err ? null : out));
  });
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const split = (l: string) => {
    const out: string[] = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === "," && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  return { header: split(lines[0] ?? ""), rows: lines.slice(1).map(split) };
}

// ---------------- NFL: nflverse play-by-play -> EPA per play ----------------
const NFL_NAMES: Record<string, string> = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills", CAR: "Carolina Panthers", CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals", CLE: "Cleveland Browns", DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs", LA: "Los Angeles Rams", LAC: "Los Angeles Chargers",
  LV: "Las Vegas Raiders", MIA: "Miami Dolphins", MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SEA: "Seattle Seahawks", SF: "San Francisco 49ers", TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans", WAS: "Washington Commanders",
};
const PLAYS_PER_GAME = 62;

async function nflSeason(y: number): Promise<RatingTable | null> {
  const gz = await download(`https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${y}.csv.gz`);
  if (!gz) return null;
  const { header, rows } = parseCsv(zlib.gunzipSync(gz).toString("utf8"));
  const ix = (k: string) => header.indexOf(k);
  const [iType, iPlay, iPos, iDef, iEpa, iGame] = ["season_type", "play_type", "posteam", "defteam", "epa", "game_id"].map(ix);
  if ([iType, iPlay, iPos, iDef, iEpa].some((i) => i < 0)) return null;
  const off = new Map<string, { n: number; epa: number; games: Set<string> }>(), def = new Map<string, { n: number; epa: number }>();
  for (const r of rows) {
    if (r[iType] !== "REG" || (r[iPlay] !== "pass" && r[iPlay] !== "run") || !r[iEpa]) continue;
    const e = Number(r[iEpa]);
    if (!Number.isFinite(e)) continue;
    const o = off.get(r[iPos]) ?? { n: 0, epa: 0, games: new Set<string>() };
    o.n++; o.epa += e; o.games.add(r[iGame]); off.set(r[iPos], o);
    const d = def.get(r[iDef]) ?? { n: 0, epa: 0 };
    d.n++; d.epa += e; def.set(r[iDef], d);
  }
  if (!off.size) return null;
  const teams = [...off.entries()].filter(([abbr]) => NFL_NAMES[abbr]).map(([abbr, o]) => {
    const d = def.get(abbr) ?? { n: 1, epa: 0 };
    const offPts = (o.epa / o.n) * PLAYS_PER_GAME, defPts = -(d.epa / d.n) * PLAYS_PER_GAME;   // positive defense = good
    return { name: NFL_NAMES[abbr], abbr: abbr === "LA" ? "LAR" : abbr === "WAS" ? "WSH" : abbr,
      r: { powerRating: offPts + defPts, efficiency: Number(((o.epa / o.n - d.epa / d.n) * 100).toFixed(1)), offense: offPts, defense: defPts, sampleSize: o.games.size } };
  });
  return { source: `nflverse EPA ${y}`, teams };
}

/**
 * Early-season numbers are noisy, so this season is blended with last season. Last season counts as
 * PRIOR_GAMES games' worth of evidence (regressed halfway to average, since rosters change), and fades as games pile up.
 */
const PRIOR_GAMES = 5;
export function blendSeasons(cur: RatingTable | null, prev: RatingTable | null, label: string): RatingTable | null {
  if (!cur && !prev) return null;
  if (!prev) return cur;
  const teams = (cur ?? prev).teams.map((t) => {
    const p = prev.teams.find((x) => (x.abbr && x.abbr === t.abbr) || x.name === t.name)?.r;
    const c = cur ? t.r : undefined;
    const n = c?.sampleSize ?? 0;
    const mix = (a?: number, b?: number) => ((a ?? 0) * n + (b ?? 0) * 0.5 * PRIOR_GAMES) / (n + PRIOR_GAMES);
    if (!p) return t;
    if (!c) return { ...t, r: { ...p, powerRating: p.powerRating * 0.5, offense: (p.offense ?? 0) * 0.5, defense: (p.defense ?? 0) * 0.5, sampleSize: Math.round(PRIOR_GAMES / 2) } };
    return { ...t, r: { ...c, powerRating: mix(c.powerRating, p.powerRating), offense: mix(c.offense, p.offense), defense: mix(c.defense, p.defense), sampleSize: n + Math.round(PRIOR_GAMES / 2) } };
  });
  return { source: label, teams };
}

export async function nflverse(now: Date): Promise<RatingTable | null> {
  const year = seasonYear(now, true);
  const cur = await nflSeason(year);
  const curGames = cur ? Math.max(...cur.teams.map((t) => t.r.sampleSize)) : 0;
  const prev = curGames < 12 ? await nflSeason(year - 1) : null;
  return blendSeasons(cur, prev, prev ? `nflverse EPA ${year} + ${year - 1} prior` : `nflverse EPA ${year}`);
}

// ---------------- NHL: MoneyPuck expected goals ----------------
const NHL_NAMES: Record<string, string> = {
  ANA: "Anaheim Ducks", BOS: "Boston Bruins", BUF: "Buffalo Sabres", CGY: "Calgary Flames", CAR: "Carolina Hurricanes", CHI: "Chicago Blackhawks",
  COL: "Colorado Avalanche", CBJ: "Columbus Blue Jackets", DAL: "Dallas Stars", DET: "Detroit Red Wings", EDM: "Edmonton Oilers", FLA: "Florida Panthers",
  LAK: "Los Angeles Kings", "L.A": "Los Angeles Kings", MIN: "Minnesota Wild", MTL: "Montreal Canadiens", NSH: "Nashville Predators", NJD: "New Jersey Devils", "N.J": "New Jersey Devils",
  NYI: "New York Islanders", NYR: "New York Rangers", OTT: "Ottawa Senators", PHI: "Philadelphia Flyers", PIT: "Pittsburgh Penguins", SJS: "San Jose Sharks", "S.J": "San Jose Sharks",
  SEA: "Seattle Kraken", STL: "St. Louis Blues", TBL: "Tampa Bay Lightning", "T.B": "Tampa Bay Lightning", TOR: "Toronto Maple Leafs", UTA: "Utah Mammoth",
  VAN: "Vancouver Canucks", VGK: "Vegas Golden Knights", WSH: "Washington Capitals", WPG: "Winnipeg Jets",
};

export async function moneypuck(now: Date): Promise<RatingTable | null> {
  const year = seasonYear(now, true);
  const cur = await moneypuckSeason(year);
  const curGames = cur ? Math.max(...cur.teams.map((t) => t.r.sampleSize)) : 0;
  const prev = curGames < 30 ? await moneypuckSeason(year - 1) : null;
  return blendSeasons(cur, prev, prev ? `MoneyPuck xG ${year} + ${year - 1} prior` : `MoneyPuck xG ${year}`);
}

async function moneypuckSeason(year: number): Promise<RatingTable | null> {
  for (const y of [year]) {
    const buf = await download(`https://moneypuck.com/moneypuck/playerData/seasonSummary/${y}/regular/teams.csv`);
    if (!buf) continue;
    const { header, rows } = parseCsv(buf.toString("utf8"));
    const ix = (k: string) => header.indexOf(k);
    const [iTeam, iSit, iGp, iXf, iXa, iGf, iGa] = ["team", "situation", "games_played", "xGoalsFor", "xGoalsAgainst", "goalsFor", "goalsAgainst"].map(ix);
    if ([iTeam, iSit, iGp, iXf, iXa].some((i) => i < 0)) continue;
    const teams = rows.filter((r) => r[iSit] === "all").map((r) => {
      const gp = Number(r[iGp]) || 1;
      // blend expected goals (70%) with actual goals (30%): xG is more predictive, goals catch finishing/goaltending
      const gf = 0.7 * Number(r[iXf]) / gp + 0.3 * Number(r[iGf] ?? r[iXf]) / gp;
      const ga = 0.7 * Number(r[iXa]) / gp + 0.3 * Number(r[iGa] ?? r[iXa]) / gp;
      return { name: NHL_NAMES[r[iTeam]] ?? r[iTeam], abbr: r[iTeam], r: { powerRating: gf - ga, offense: gf - 3.05, defense: 3.05 - ga, sampleSize: gp } };
    });
    if (teams.length) return { source: `MoneyPuck xG ${y}`, teams };
  }
  return null;
}

// ---------------- MLB: official standings (runs scored / allowed) ----------------
export async function mlbStandings(now: Date): Promise<RatingTable | null> {
  const d = await getJson<J>("https://statsapi.mlb.com/api/v1/standings", { leagueId: "103,104", season: now.getUTCFullYear(), standingsTypes: "regularSeason" });
  if (!d) return null;
  const teams: RatingTable["teams"] = [];
  for (const rec of d.records ?? []) for (const t of rec.teamRecords ?? []) {
    const gp = t.gamesPlayed || (t.wins ?? 0) + (t.losses ?? 0);
    if (!gp) continue;
    const rs = (t.runsScored ?? 0) / gp, ra = (t.runsAllowed ?? 0) / gp;
    teams.push({ name: t.team?.name, r: { powerRating: rs - ra, offense: rs - 4.4, defense: 4.4 - ra, sampleSize: gp } });
  }
  return teams.length ? { source: "MLB.com standings", teams } : null;
}

// ---------------- College football: CollegeFootballData SP+ (free key) ----------------
export async function cfbdSpPlus(now: Date): Promise<RatingTable | null> {
  const key = process.env.CFBD_API_KEY;
  if (!key) return null;
  const year = seasonYear(now, true);
  const res = await fetchWithKey(`https://api.collegefootballdata.com/ratings/sp?year=${year}`, { Authorization: `Bearer ${key}` });
  if (!Array.isArray(res)) return null;
  // SP+ is points better than an average team on a neutral field, so margin = SP(home) - SP(away)
  const teams = (res as J[]).filter((t) => typeof t.rating === "number").map((t) => ({
    name: t.team, r: { powerRating: t.rating, offense: (t.offense?.rating ?? 27.5) - 27.5, defense: 27.5 - (t.defense?.rating ?? 27.5), sampleSize: 12 },
  }));
  return teams.length ? { source: `CollegeFootballData SP+ ${year}`, teams } : null;
}

// ---------------- Soccer: football-data.org standings (free key) ----------------
export async function footballData(competition: "PL" | "CL"): Promise<RatingTable | null> {
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) return null;
  const res = (await fetchWithKey(`https://api.football-data.org/v4/competitions/${competition}/standings`, { "X-Auth-Token": key })) as J | null;
  const table: J[] = res?.standings?.find((s: J) => s.type === "TOTAL")?.table ?? res?.standings?.[0]?.table ?? [];
  const teams = table.filter((t) => t.playedGames).map((t) => {
    const gf = t.goalsFor / t.playedGames, ga = t.goalsAgainst / t.playedGames;
    return { name: t.team?.name, r: { powerRating: gf - ga, offense: gf - 1.4, defense: 1.4 - ga, sampleSize: t.playedGames } };
  });
  return teams.length ? { source: `football-data.org ${competition}`, teams } : null;
}

async function fetchWithKey(url: string, headers: Record<string, string>): Promise<unknown> {
  try {
    const r = await fetch(url, { headers: { ...headers, Accept: "application/json" } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
