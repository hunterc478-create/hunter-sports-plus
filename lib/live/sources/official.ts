/** Official league feeds (free, no key): MLB Stats API, NHL web API, NBA CDN schedule. Games + scores. */
import type { Matchup } from "@/types/sports";
import { getJson } from "../http";
import type { Registry } from "../registry";
type J = Record<string, any>;

export async function mlbOfficial(reg: Registry, startKey: string, endKey: string): Promise<number | null> {
  const d = await getJson<J>("https://statsapi.mlb.com/api/v1/schedule", { sportId: 1, startDate: startKey, endDate: endKey, hydrate: "probablePitcher,venue,linescore" });
  if (!d) return null;
  let count = 0;
  for (const day of d.dates ?? []) for (const gm of day.games ?? []) {
    const ab = gm.status?.abstractGameState;
    const status: Matchup["status"] = ab === "Final" ? "final" : ab === "Live" ? "live" : "scheduled";
    const H = gm.teams?.home ?? {}, A = gm.teams?.away ?? {};
    const rec = (t: J) => (t.leagueRecord ? `${t.leagueRecord.wins}-${t.leagueRecord.losses}` : undefined);
    reg.upsert({
      id: "", league: "MLB", startTime: gm.gameDate, status,
      home: { id: `mlb-${H.team?.id}`, name: H.team?.name, shortName: H.team?.teamName ?? H.team?.name, record: rec(H) },
      away: { id: `mlb-${A.team?.id}`, name: A.team?.name, shortName: A.team?.teamName ?? A.team?.name, record: rec(A) },
      venue: gm.venue?.name ? { name: gm.venue.name, city: gm.venue.location?.city ?? "", indoor: false } : undefined,
      score: status !== "scheduled" && H.score !== undefined ? { home: H.score, away: A.score ?? 0 } : undefined,
    }, "MLB.com", {
      venueCity: gm.venue?.location?.city,
      probables: { home: H.probablePitcher ? { name: H.probablePitcher.fullName } : undefined, away: A.probablePitcher ? { name: A.probablePitcher.fullName } : undefined },
    });
    count++;
  }
  return count;
}

export async function nhlOfficial(reg: Registry, days: string[]): Promise<number | null> {
  let count = 0, any = false;
  const seen = new Set<number>();
  for (const day of days.filter((_, i) => i % 7 === 0)) {     // the schedule endpoint returns a full week
    const d = await getJson<J>(`https://api-web.nhle.com/v1/schedule/${day}`);
    if (!d) continue;
    any = true;
    for (const wk of d.gameWeek ?? []) for (const gm of wk.games ?? []) {
      if (seen.has(gm.id)) continue;
      seen.add(gm.id);
      const st = gm.gameState;
      const status: Matchup["status"] = st === "FINAL" || st === "OFF" ? "final" : st === "LIVE" || st === "CRIT" ? "live" : "scheduled";
      const t = (x: J) => {
        const place = x.placeName?.default ?? "", common = x.commonName?.default ?? x.name?.default ?? "";
        return { id: `nhl-${x.abbrev}`, name: `${place} ${common}`.trim(), shortName: common || place, abbreviation: x.abbrev };
      };
      reg.upsert({
        id: "", league: "NHL", startTime: gm.startTimeUTC, status, home: t(gm.homeTeam), away: t(gm.awayTeam),
        venue: gm.venue?.default ? { name: gm.venue.default, city: "", indoor: true } : undefined,
        score: status !== "scheduled" && gm.homeTeam?.score !== undefined ? { home: gm.homeTeam.score, away: gm.awayTeam?.score ?? 0 } : undefined,
      }, "NHL.com", { homeLocation: gm.homeTeam?.placeName?.default, awayLocation: gm.awayTeam?.placeName?.default });
      count++;
    }
  }
  return any ? count : null;
}

export async function nbaOfficial(reg: Registry, startKey: string, endKey: string): Promise<number | null> {
  const d = await getJson<J>("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json");
  if (!d) return null;
  let count = 0;
  for (const gd of d.leagueSchedule?.gameDates ?? []) for (const gm of gd.games ?? []) {
    const when: string = gm.gameDateTimeUTC ?? gm.gameDateUTC;
    if (!when) continue;
    const day = when.slice(0, 10);
    if (day < startKey || day > endKey) continue;
    const status: Matchup["status"] = gm.gameStatus === 3 ? "final" : gm.gameStatus === 2 ? "live" : "scheduled";
    const t = (x: J) => ({ id: `nba-${x.teamId}`, name: `${x.teamCity} ${x.teamName}`, shortName: x.teamName, abbreviation: x.teamTricode });
    reg.upsert({
      id: "", league: "NBA", startTime: when, status, home: t(gm.homeTeam), away: t(gm.awayTeam),
      venue: gm.arenaName ? { name: gm.arenaName, city: gm.arenaCity ?? "", indoor: true } : undefined,
      score: status !== "scheduled" ? { home: gm.homeTeam?.score ?? 0, away: gm.awayTeam?.score ?? 0 } : undefined,
    }, "NBA.com", { homeLocation: gm.homeTeam?.teamCity, awayLocation: gm.awayTeam?.teamCity });
    count++;
  }
  return count;
}
