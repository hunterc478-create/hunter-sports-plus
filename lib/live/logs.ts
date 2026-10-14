/**
 * Game logs for the hit-rate charts (tap a bet: did it clear this line in each recent game?).
 *   Teams: ESPN team schedules (free), this season + last season, final scores only. Cached in
 *   public/data/team-logs.json and refreshed every 6 hours per team, so a run only asks about a few teams.
 */
import fs from "node:fs";
import path from "node:path";
import type { MatchupCardData } from "@/types/sports";
import { ESPN_PATHS } from "./espn";
import { getJson, pool } from "./http";

/** One finished game for a team: date, opponent, home?, points for / against, last season? */
export type TeamGame = { d: string; o: string; h: 0 | 1; f: number; a: number; ls?: 1 };
type Cache = Record<string, { at: string; games: TeamGame[] }>;
const FILE = path.join("public", "data", "team-logs.json");
const KEEP = 25;
const STALE_MS = 6 * 3600_000;

type Ev = { date: string; competitions: { status: { type: { completed: boolean } }; competitors: { id: string; homeAway: string; team: { abbreviation?: string; shortDisplayName?: string }; score?: { value?: number; displayValue?: string } | string }[] }[] };
const score = (s: unknown) => (typeof s === "object" && s ? Number((s as { value?: number; displayValue?: string }).value ?? (s as { displayValue?: string }).displayValue) : Number(s));

async function schedule(pathPart: string, teamId: string, season?: number): Promise<{ games: TeamGame[]; season?: number }> {
  const d = await getJson<{ events?: Ev[]; requestedSeason?: { year?: number } }>(
    `https://site.api.espn.com/apis/site/v2/sports/${pathPart}/teams/${teamId}/schedule`, season ? { season: String(season) } : undefined);
  const games: TeamGame[] = [];
  for (const e of d?.events ?? []) {
    const c = e.competitions?.[0];
    if (!c?.status?.type?.completed) continue;
    const me = c.competitors.find((x) => String(x.id) === teamId), opp = c.competitors.find((x) => String(x.id) !== teamId);
    if (!me || !opp) continue;
    const f = score(me.score), a = score(opp.score);
    if (!Number.isFinite(f) || !Number.isFinite(a)) continue;
    games.push({ d: e.date, o: opp.team.abbreviation ?? opp.team.shortDisplayName ?? "", h: me.homeAway === "home" ? 1 : 0, f, a });
  }
  return { games, season: d?.requestedSeason?.year };
}

/** Logs for every team on the board, most recent first, keyed "<league>:<ESPN team id>". */
export async function teamLogs(cards: MatchupCardData[]): Promise<Record<string, TeamGame[]>> {
  let cache: Cache = {};
  try { cache = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {
    if (process.env.SITE_URL) cache = (await getJson<Cache>(`${process.env.SITE_URL.replace(/\/$/, "")}/data/team-logs.json`)) ?? {};
  }
  const want = new Map<string, { league: string; id: string }>();
  for (const c of cards) for (const t of [c.matchup.home, c.matchup.away])
    if (ESPN_PATHS[c.matchup.league] && /^\d+$/.test(t.id)) want.set(`${c.matchup.league}:${t.id}`, { league: c.matchup.league, id: t.id });
  const now = Date.now();
  const todo = [...want.entries()].filter(([k]) => !cache[k] || now - new Date(cache[k].at).getTime() > STALE_MS);
  await pool(todo, 6, async ([k, t]) => {
    const p = ESPN_PATHS[t.league as keyof typeof ESPN_PATHS]!.path;
    const cur = await schedule(p, t.id);
    const prev = cur.season ? await schedule(p, t.id, cur.season - 1) : { games: [] };
    const games = [...cur.games.sort((a, b) => b.d.localeCompare(a.d)), ...prev.games.sort((a, b) => b.d.localeCompare(a.d)).map((g) => ({ ...g, ls: 1 as const }))].slice(0, KEEP);
    if (games.length) cache[k] = { at: new Date().toISOString(), games };
  });
  // keep the cache to the teams on the board (plus a day of slack), publish it with the site
  const keep: Cache = {};
  for (const [k, v] of Object.entries(cache)) if (want.has(k) || now - new Date(v.at).getTime() < 36 * 3600_000) keep[k] = v;
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(keep)); } catch { /* read-only */ }
  return Object.fromEntries([...want.keys()].filter((k) => keep[k]).map((k) => [k, keep[k].games]));
}
