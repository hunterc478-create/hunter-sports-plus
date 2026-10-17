/**
 * Player game logs for the hit-rate charts on soccer and MLB props (ESPN, free).
 *   ids:  the two teams' ESPN rosters (name -> athlete id)
 *   logs: ESPN's athlete game log (soccer: every competition; MLB: the season), one value per game for the prop's stat
 * Cached in public/data/player-logs.json and refreshed every 12 hours per player.
 */
import fs from "node:fs";
import path from "node:path";
import type { MatchupCardData, PlayerProp } from "@/types/sports";
import { ESPN_PATHS } from "./espn";
import { getJson, pool } from "./http";
import { pname } from "./sources/tennis";

type Game = { w: number; o: string; v: number; t?: string };
type Cache = Record<string, { at: string; games: Game[] }>;
const FILE = path.join("public", "data", "player-logs.json");
const STALE_MS = 12 * 3600_000;

/** Which game-log column(s) make each prop stat. */
const STAT: Record<string, (row: Record<string, number>) => number | undefined> = {
  goals: (r) => r.totalGoals,
  shots_on_target: (r) => r.shotsOnTarget,
  strikeouts: (r) => r.strikeouts,
  total_bases: (r) => (r.hits === undefined ? undefined : r.hits + (r.doubles ?? 0) + 2 * (r.triples ?? 0) + 3 * (r.homeRuns ?? 0)),
};
const sportPath = (league: string) => (league === "MLB" ? "baseball/mlb" : "soccer/all");

type J = Record<string, unknown>;
async function roster(league: string, teamId: string): Promise<Map<string, { id: string; team: string }>> {
  const p = ESPN_PATHS[league as keyof typeof ESPN_PATHS]?.path;
  const out = new Map<string, { id: string; team: string }>();
  if (!p) return out;
  const d = await getJson<{ athletes?: J[]; team?: { abbreviation?: string } }>(`https://site.api.espn.com/apis/site/v2/sports/${p}/teams/${teamId}/roster`);
  const team = d?.team?.abbreviation ?? "";
  // soccer lists players flat; MLB groups them by position
  const flat = (d?.athletes ?? []).flatMap((a) => (Array.isArray(a.items) ? (a.items as J[]) : [a]));
  for (const a of flat) if (typeof a.displayName === "string" && a.id) out.set(pname(a.displayName), { id: String(a.id), team });
  return out;
}

async function gameLog(league: string, athleteId: string, stat: string, team: string): Promise<Game[]> {
  const d = await getJson<{ names?: string[]; events?: Record<string, { gameDate?: string; opponent?: { abbreviation?: string } }>; seasonTypes?: { categories?: { type?: string; events?: { eventId: string; stats: string[] }[] }[] }[] }>(
    `https://site.web.api.espn.com/apis/common/v3/sports/${sportPath(league)}/athletes/${athleteId}/gamelog`);
  if (!d?.names || !d.events) return [];
  const pick = STAT[stat];
  const rows: { date: string; o: string; v: number }[] = [];
  for (const st of d.seasonTypes ?? []) for (const cat of st.categories ?? []) {
    if (cat.type && cat.type !== "event") continue;
    for (const e of cat.events ?? []) {
      const r: Record<string, number> = {};
      d.names.forEach((n, i) => { const v = Number(e.stats[i]); if (Number.isFinite(v)) r[n] = v; });
      const v = pick?.(r);
      const meta = d.events[e.eventId];
      if (v === undefined || !meta) continue;
      rows.push({ date: meta.gameDate ?? "", o: meta.opponent?.abbreviation ?? "", v });
    }
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map((r, i) => ({ w: i, o: r.o, v: r.v, t: team }));
}

/** Logs keyed "<player>|<stat>" for every soccer / MLB prop on the board. */
export async function playerLogs(cards: MatchupCardData[], props: PlayerProp[]): Promise<Record<string, Game[]>> {
  let cache: Cache = {};
  try { cache = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {
    if (process.env.SITE_URL) cache = (await getJson<Cache>(`${process.env.SITE_URL.replace(/\/$/, "")}/data/player-logs.json`)) ?? {};
  }
  const wanted = props.filter((p) => STAT[p.stat]);
  const byGame = new Map<string, PlayerProp[]>();
  for (const p of wanted) byGame.set(p.matchupId, [...(byGame.get(p.matchupId) ?? []), p]);
  const now = Date.now();
  const keys = new Set<string>();
  await pool([...byGame.entries()], 3, async ([id, list]) => {
    const c = cards.find((x) => x.matchup.id === id);
    if (!c) return;
    const need = [...new Set(list.map((p) => `${p.playerName}|${p.stat}`))];
    need.forEach((k) => keys.add(k));
    const todo = need.filter((k) => !cache[k] || now - new Date(cache[k].at).getTime() > STALE_MS);
    if (!todo.length) return;
    const ids = new Map([...(await roster(c.matchup.league, c.matchup.home.id)), ...(await roster(c.matchup.league, c.matchup.away.id))]);
    await pool(todo, 4, async (k) => {
      const [player, stat] = k.split("|");
      const a = ids.get(pname(player));
      if (!a) return;
      const games = await gameLog(c.matchup.league, a.id, stat, a.team);
      if (games.length) cache[k] = { at: new Date().toISOString(), games };
    });
  });
  const keep: Cache = {};
  for (const [k, v] of Object.entries(cache)) if (keys.has(k) || now - new Date(v.at).getTime() < 48 * 3600_000) keep[k] = v;
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(keep)); } catch { /* read-only */ }
  return Object.fromEntries([...keys].filter((k) => keep[k]).map((k) => [k, keep[k].games]));
}
