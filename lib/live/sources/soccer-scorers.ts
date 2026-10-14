/**
 * Soccer goalscorers: our anytime-goalscorer chance.
 *   Season scoring: ESPN's top-50 scorers per league (goals and matches played, free), domestic + Champions League.
 *   expected goals = his goals per match (shrunk toward 0.2 with 3 matches of weight) x his team's projected goals
 *                    tonight vs a typical team's
 *   P(scores) = 1 - e^(-expected goals)
 */
import type { MatchupCardData, PlayerProp, WhyPart } from "@/types/sports";
import { paramsFor } from "@/lib/engine/sport-params";
import { getJson } from "../http";
import { sameTeam } from "../registry";
import { pname } from "./tennis";

const PATHS = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "usa.1", "uefa.champions"];
export type Scorer = { name: string; goals: number; matches: number; team: string };

export async function soccerScorers(): Promise<Map<string, Scorer>> {
  const out = new Map<string, Scorer>();
  for (const p of PATHS) {
    const d = await getJson<{ stats?: { name: string; leaders?: { value: number; displayValue?: string; athlete: { displayName: string; team?: { displayName?: string } } }[] }[] }>(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${p}/statistics`);
    const goals = d?.stats?.find((s) => s.name === "goalsLeaders")?.leaders ?? [];
    for (const l of goals) {
      const matches = Number(l.displayValue?.match(/Matches:\s*(\d+)/)?.[1]) || 0;
      if (!matches) continue;
      const k = pname(l.athlete.displayName);
      const ex = out.get(k);
      // domestic league + Champions League add up
      out.set(k, ex ? { ...ex, goals: ex.goals + l.value, matches: ex.matches + matches, team: ex.team || (l.athlete.team?.displayName ?? "") }
        : { name: l.athlete.displayName, goals: l.value, matches, team: l.athlete.team?.displayName ?? "" });
    }
  }
  return out;
}

const PRIOR_RATE = 0.2, PRIOR_MATCHES = 3;

/** Our chance he scores, with the reasons, or null when he isn't among the season's scorers we track. */
export function goalChance(p: PlayerProp, c: MatchupCardData, scorers: Map<string, Scorer>): { prob: number; parts: WhyPart[]; why: string } | null {
  const s = scorers.get(pname(p.playerName));
  if (!s || s.matches < 3) return null;
  const m = c.matchup;
  // his team from the scorer list, else from the book's roster match; an empty name must not match anyone
  const is = (t: string, team: string) => !!t && sameTeam(t, team);
  const side = is(s.team, m.home.name) ? "home" : is(s.team, m.away.name) ? "away" : s.team ? null
    : is(p.team, m.home.name) ? "home" : is(p.team, m.away.name) ? "away" : null;
  if (!side) return null;
  const rate = (s.goals + PRIOR_RATE * PRIOR_MATCHES) / (s.matches + PRIOR_MATCHES);
  const typical = paramsFor(m.league).avgTotal / 2;
  const proj = side === "home" ? c.prediction.projectedScore.home : c.prediction.projectedScore.away;
  const factor = Math.max(0.7, Math.min(1.4, 1 + 0.6 * (proj / typical - 1)));
  const xg = rate * factor;
  const prob = 1 - Math.exp(-xg);
  const team = side === "home" ? m.home.shortName : m.away.shortName, opp = side === "home" ? m.away.shortName : m.home.shortName;
  const parts: WhyPart[] = [
    { k: "Our projection", text: `${Math.round(prob * 100)}% to score (${xg.toFixed(2)} expected goals)` },
    { k: "This season", text: `${s.goals} goals in ${s.matches} matches (${(s.goals / s.matches).toFixed(2)} a match)`, f: rate / 0.3 },
    { k: "Team tonight", text: `${team} projected for ${proj.toFixed(1)} goals vs ${opp} (a typical team scores ${typical.toFixed(1)})`, f: factor },
    { k: "Minutes", text: "Season rate includes sub appearances; a benching or early sub lowers it", ctx: true },
  ];
  return { prob, parts, why: `${s.goals} goals in ${s.matches} matches; ${team} projected for ${proj.toFixed(1)} goals tonight.` };
}
