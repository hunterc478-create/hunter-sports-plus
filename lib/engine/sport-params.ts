import type { LeagueId, Sport } from "@/types/sports";
import { LEAGUES } from "@/lib/leagues";

/**
 * Per-sport constants for the factor model.
 * homeEdge: home advantage in the sport's units. marginSd / totalSd: spread of real outcomes around a projection.
 * prior: games of data before a rating is trusted at 50%.
 */
export interface SportParams {
  homeEdge: number;
  marginSd: number;
  totalSd: number;
  prior: number;
  restPerDay: number;
  backToBackPenalty: number;
  travelPerTimezone: number;
  avgTotal: number;
}

export const SPORT_PARAMS: Record<Sport, SportParams> = {
  football: { homeEdge: 1.5, marginSd: 13.5, totalSd: 10, prior: 6, restPerDay: 0.4, backToBackPenalty: 0, travelPerTimezone: 0.4, avgTotal: 44 },
  basketball: { homeEdge: 2.2, marginSd: 12, totalSd: 14, prior: 10, restPerDay: 0.6, backToBackPenalty: 2, travelPerTimezone: 0.5, avgTotal: 226 },
  baseball: { homeEdge: 0.15, marginSd: 4.2, totalSd: 4.3, prior: 25, restPerDay: 0, backToBackPenalty: 0, travelPerTimezone: 0.05, avgTotal: 8.8 },
  hockey: { homeEdge: 0.15, marginSd: 2.4, totalSd: 2.2, prior: 15, restPerDay: 0.06, backToBackPenalty: 0.25, travelPerTimezone: 0.03, avgTotal: 6.1 },
  soccer: { homeEdge: 0.3, marginSd: 1.7, totalSd: 1.6, prior: 8, restPerDay: 0.05, backToBackPenalty: 0, travelPerTimezone: 0.02, avgTotal: 2.8 },
  tennis: { homeEdge: 0, marginSd: 1, totalSd: 5, prior: 15, restPerDay: 0.02, backToBackPenalty: 0.05, travelPerTimezone: 0, avgTotal: 22 },
  mma: { homeEdge: 0, marginSd: 1, totalSd: 1, prior: 5, restPerDay: 0, backToBackPenalty: 0, travelPerTimezone: 0, avgTotal: 2.5 },
};

/** League-level overrides where a league plays differently from its sport's pro default. */
const LEAGUE_OVERRIDES: Partial<Record<LeagueId, Partial<SportParams>>> = {
  NCAAF: { homeEdge: 2.5, marginSd: 16, totalSd: 14, avgTotal: 55, travelPerTimezone: 0.5 },
  NCAAB: { homeEdge: 3.2, marginSd: 11, totalSd: 13, avgTotal: 142, restPerDay: 0.3, backToBackPenalty: 1 },
  MLS: { homeEdge: 0.4, avgTotal: 3.0 },
  BUNDESLIGA: { avgTotal: 3.1 },
  SERIEA: { avgTotal: 2.6 },
  LALIGA: { avgTotal: 2.6 },
  WNBA: { homeEdge: 1.8, marginSd: 11, totalSd: 12, avgTotal: 164, restPerDay: 0.4, backToBackPenalty: 1.5 },
  NCAAW: { homeEdge: 3.0, marginSd: 12, totalSd: 12, avgTotal: 135, restPerDay: 0.3, backToBackPenalty: 1 },
};

/** Parameters for a specific league: the sport's defaults plus any league override. */
export function paramsFor(league: LeagueId): SportParams {
  return { ...SPORT_PARAMS[LEAGUES[league].sport], ...(LEAGUE_OVERRIDES[league] ?? {}) };
}
