/**
 * TD derby: anytime-touchdown chances for every NFL player who gets the ball.
 *   expected TDs = recent TD rate (blended with last season) x opponent TDs allowed to the position
 *                  x team scoring outlook (the model's projected points vs the team's usual, up to +/-25%)
 *   P(scores) = 1 - e^(-expected TDs)
 */
import type { MatchupCardData, PlayerProp, TdCandidate, WhyPart } from "@/types/sports";
import { propContext } from "./why";
import { probToAmerican, impliedProb } from "@/lib/odds-math";
import { normName, toNflverseAbbr, type NflPlayers } from "./players/nfl";

export function tdDerby(cards: MatchupCardData[], players: NflPlayers | null, kalshiProps: PlayerProp[], outByTeam: Map<string, Set<string>>, why?: Record<string, WhyPart[]>): TdCandidate[] {
  if (!players) return [];
  const out: TdCandidate[] = [];
  for (const c of cards.filter((x) => x.matchup.league === "NFL" && x.matchup.status === "scheduled")) {
    for (const side of ["home", "away"] as const) {
      const team = toNflverseAbbr(c.matchup[side].abbreviation);
      const opp = toNflverseAbbr(c.matchup[side === "home" ? "away" : "home"].abbreviation);
      if (!team || !opp) continue;
      const pts = side === "home" ? c.prediction.projectedScore.home : c.prediction.projectedScore.away;
      const usual = 22 + ((side === "home" ? c.factors.home : c.factors.away).ratings.offense ?? 0);
      const script = usual > 0 ? 1 + 0.5 * (pts / usual - 1) : 1;   // TDs move with points, but early-season point projections are noisy
      const teamOut = outByTeam.get(`${c.matchup.id}:${side}`) ?? new Set<string>();
      for (const cand of players.candidates(team)) {
        if (teamOut.has(normName(cand.name))) continue;
        const proj = players.project(cand.name, "anytime_td", opp, script, 0.15, players.usageBoost(cand.name, team, teamOut, "anytime_td"));
        if (!proj || proj.mean < 0.05) continue;
        const prob = Math.min(0.68, 1 - Math.exp(-proj.mean));
        if (why) why[`${c.matchup.id}|${cand.name}|anytime_td`] = [...proj.parts, ...propContext(c, side === "home", "anytime_td")];
        const kp = kalshiProps.find((p) => p.stat === "anytime_td" && p.side === "over" && p.line <= 0.5 && p.playerName.toLowerCase() === cand.name.toLowerCase());
        out.push({
          id: `td:${c.matchup.id}:${cand.name}`.replace(/\s+/g, "_"), matchupId: c.matchup.id, start: c.matchup.startTime,
          player: cand.name, pos: cand.pos, team: c.matchup[side].shortName, opponent: c.matchup[side === "home" ? "away" : "home"].shortName,
          expectedTds: proj.mean, prob, fairOdds: probToAmerican(prob),
          price: kp ? { americanOdds: kp.bestQuote.americanOdds, book: kp.bestQuote.bookmaker.name } : undefined,
          edge: kp ? prob - impliedProb(kp.bestQuote.americanOdds) : undefined,
          note: proj.note,
        });
      }
    }
  }
  return out.sort((a, b) => b.prob - a.prob);
}
