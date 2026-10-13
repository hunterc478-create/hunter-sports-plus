import type { League, LeagueId } from "@/types/sports";

export const LEAGUES: Record<LeagueId, League> = {
  NFL: { id: "NFL", name: "NFL", sport: "football", hasDraw: false, individual: false },
  NCAAF: { id: "NCAAF", name: "College Football", sport: "football", hasDraw: false, individual: false },
  NBA: { id: "NBA", name: "NBA", sport: "basketball", hasDraw: false, individual: false },
  NCAAB: { id: "NCAAB", name: "College Basketball", sport: "basketball", hasDraw: false, individual: false },
  MLB: { id: "MLB", name: "MLB", sport: "baseball", hasDraw: false, individual: false },
  NHL: { id: "NHL", name: "NHL", sport: "hockey", hasDraw: false, individual: false },
  EPL: { id: "EPL", name: "Premier League", sport: "soccer", hasDraw: true, individual: false },
  MLS: { id: "MLS", name: "MLS", sport: "soccer", hasDraw: true, individual: false },
  UCL: { id: "UCL", name: "Champions League", sport: "soccer", hasDraw: true, individual: false },
  LALIGA: { id: "LALIGA", name: "La Liga", sport: "soccer", hasDraw: true, individual: false },
  SERIEA: { id: "SERIEA", name: "Serie A", sport: "soccer", hasDraw: true, individual: false },
  BUNDESLIGA: { id: "BUNDESLIGA", name: "Bundesliga", sport: "soccer", hasDraw: true, individual: false },
  LIGUE1: { id: "LIGUE1", name: "Ligue 1", sport: "soccer", hasDraw: true, individual: false },
  WNBA: { id: "WNBA", name: "WNBA", sport: "basketball", hasDraw: false, individual: false },
  NCAAW: { id: "NCAAW", name: "Women's College Basketball", sport: "basketball", hasDraw: false, individual: false },
  ATP: { id: "ATP", name: "ATP Tennis", sport: "tennis", hasDraw: false, individual: true },
  WTA: { id: "WTA", name: "WTA Tennis", sport: "tennis", hasDraw: false, individual: true },
  UFC: { id: "UFC", name: "UFC / MMA", sport: "mma", hasDraw: false, individual: true },
};

/** The Odds API sport keys for each league. */
export const ODDS_API_KEYS: Partial<Record<LeagueId, string>> = {
  NFL: "americanfootball_nfl",
  NCAAF: "americanfootball_ncaaf",
  NBA: "basketball_nba",
  NCAAB: "basketball_ncaab",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
  EPL: "soccer_epl",
  MLS: "soccer_usa_mls",
  UCL: "soccer_uefa_champs_league",
  LALIGA: "soccer_spain_la_liga",
  SERIEA: "soccer_italy_serie_a",
  BUNDESLIGA: "soccer_germany_bundesliga",
  LIGUE1: "soccer_france_ligue_one",
  WNBA: "basketball_wnba",
  NCAAW: "basketball_wncaab",
  UFC: "mma_mixed_martial_arts",
  // Tennis keys are tournament-specific on The Odds API (e.g. tennis_atp_us_open); resolve them at runtime.
};
