/** Action Network public scoreboard (free, unofficial): games, scores, and lines from ~10 sportsbooks. */
import type { LeagueId, Matchup } from "@/types/sports";
import { getJson } from "../http";
import type { Registry } from "../registry";

const SLUG: Partial<Record<LeagueId, string>> = { NFL: "nfl", NCAAF: "ncaaf", NBA: "nba", NCAAB: "ncaab", MLB: "mlb", NHL: "nhl", WNBA: "wnba", NCAAW: "ncaaw" };
/** Soccer comes from one "soccer" scoreboard covering every league; each game says which league it's in. */
const SOCCER: Partial<Record<LeagueId, string[]>> = {
  EPL: ["epl"], MLS: ["mls"], LALIGA: ["laliga"], SERIEA: ["seriea"], BUNDESLIGA: ["bundesliga"], LIGUE1: ["ligue1"], UCL: ["ucl", "championsleague", "uefachampionsleague"],
};
const soccerDays = new Map<string, Promise<J | null>>();   // one request per day, shared by every soccer league
const BOOKS: Record<number, string> = { 15: "DraftKings", 30: "FanDuel", 68: "DraftKings", 69: "FanDuel", 71: "BetRivers", 75: "BetMGM", 79: "bet365", 123: "Caesars", 972: "Fanatics", 247: "Hard Rock", 1901: "ESPN BET" };
type J = Record<string, any>;
const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export async function actionNetwork(reg: Registry, league: LeagueId, days: string[]): Promise<{ games: number; failed: number }> {
  const soccerNames = SOCCER[league];
  const slug = soccerNames ? "soccer" : SLUG[league];
  if (!slug) return { games: 0, failed: 0 };
  let games = 0, failed = 0;
  const fetchDay = async (day: string) => {
    for (const ver of ["v2", "v1"]) {
      const d = await getJson<J>(`https://api.actionnetwork.com/web/${ver}/scoreboard/${slug}`, {
        bookIds: Object.keys(BOOKS).join(","), date: day.replace(/-/g, ""), periods: "event",
      });
      if (d) return d;
    }
    return null;
  };
  for (const day of days) {
    let data: J | null;
    if (soccerNames) {
      if (!soccerDays.has(day)) soccerDays.set(day, fetchDay(day));
      data = await soccerDays.get(day)!;
    } else data = await fetchDay(day);
    if (!data) { failed++; continue; }
    for (const gm of (data.games ?? []) as J[]) {
      if (soccerNames && !soccerNames.includes(String(gm.league_name ?? "").toLowerCase().replace(/\W+/g, ""))) continue;
      const teams = new Map(((gm.teams ?? []) as J[]).map((t) => [t.id, t]));
      const h = teams.get(gm.home_team_id), a = teams.get(gm.away_team_id);
      if (!h || !a) continue;
      const st = String(gm.status ?? "").toLowerCase();
      const status: Matchup["status"] = ["complete", "closed", "final"].includes(st) ? "final" : ["inprogress", "in_progress", "live"].includes(st) ? "live" : "scheduled";
      const box = gm.boxscore ?? {};
      const team = (t: J) => ({ id: `an-${t.id}`, name: t.full_name ?? t.display_name, shortName: t.display_name ?? t.short_name ?? t.full_name, abbreviation: t.abbr });
      const m: Matchup = {
        id: "", league, startTime: gm.start_time, status, home: team(h), away: team(a),
        score: status !== "scheduled" && n(box.total_home_points) !== undefined ? { home: n(box.total_home_points)!, away: n(box.total_away_points) ?? 0 } : undefined,
      };
      const g = reg.upsert(m, "Action Network");
      games++;
      if (status !== "scheduled") continue;
      // v2: markets -> book id -> event -> moneyline / spread / total
      for (const [bid, mk] of Object.entries((gm.markets ?? {}) as J)) {
        const book = BOOKS[Number(bid)];
        if (!book) continue;
        const ev = (mk as J)?.event ?? {};
        const side = (list: J[] | undefined, s: string) => (list ?? []).find((x) => x.side === s) ?? {};
        reg.addQuote(g, "moneyline", "home", n(side(ev.moneyline, "home").odds), undefined, book);
        reg.addQuote(g, "moneyline", "away", n(side(ev.moneyline, "away").odds), undefined, book);
        if (soccerNames) reg.addQuote(g, "moneyline", "draw", n(side(ev.moneyline, "draw").odds), undefined, book);
        const sh = side(ev.spread, "home"), sa = side(ev.spread, "away");
        if (n(sh.value) !== undefined && n(sh.value) !== 0) {
          reg.addQuote(g, "spread", "home", n(sh.odds), n(sh.value), book);
          reg.addQuote(g, "spread", "away", n(sa.odds), -n(sh.value)!, book);
        }
        const ov = side(ev.total, "over"), un = side(ev.total, "under");
        if (n(ov.value)) {
          reg.addQuote(g, "total", "over", n(ov.odds), n(ov.value), book);
          reg.addQuote(g, "total", "under", n(un.odds), n(ov.value), book);
        }
      }
      // v1: flat odds rows
      for (const o of (gm.odds ?? []) as J[]) {
        if (o.type && o.type !== "game") continue;
        const book = BOOKS[Number(o.book_id)];
        if (!book) continue;
        reg.addQuote(g, "moneyline", "home", n(o.ml_home), undefined, book);
        reg.addQuote(g, "moneyline", "away", n(o.ml_away), undefined, book);
        if (n(o.spread_home)) {
          reg.addQuote(g, "spread", "home", n(o.spread_home_line), n(o.spread_home), book);
          reg.addQuote(g, "spread", "away", n(o.spread_away_line), -n(o.spread_home)!, book);
        }
        if (n(o.total)) {
          reg.addQuote(g, "total", "over", n(o.over), n(o.total), book);
          reg.addQuote(g, "total", "under", n(o.under), n(o.total), book);
        }
      }
    }
  }
  return { games, failed };
}
