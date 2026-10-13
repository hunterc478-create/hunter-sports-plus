/**
 * GET /api/odds?league=NFL
 * Cached odds for live polling. Clients poll every ODDS_POLL_SECONDS; the cache absorbs the load so the
 * upstream API is hit at most once per ODDS_CACHE_TTL_SECONDS per league.
 */
import { NextResponse } from "next/server";
import type { LeagueId } from "@/types/sports";
import { LEAGUES } from "@/lib/leagues";
import { getLeagueOdds, OddsApiError } from "@/lib/services/odds-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const league = (new URL(req.url).searchParams.get("league") ?? "NFL").toUpperCase() as LeagueId;
  if (!LEAGUES[league]) return NextResponse.json({ error: `Unknown league ${league}` }, { status: 400 });
  try {
    const data = await getLeagueOdds(league);
    return NextResponse.json({ league, fetchedAt: new Date().toISOString(), events: data });
  } catch (e) {
    const err = e as OddsApiError;
    const status = err.status === 401 ? 401 : err.status === 429 ? 429 : 502;
    return NextResponse.json({ error: err.message, remainingCredits: err.remaining ?? null }, { status });
  }
}
