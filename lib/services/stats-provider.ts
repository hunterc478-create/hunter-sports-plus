/**
 * Stats providers feed the engine's MatchupFactors (ratings, injuries, rest, weather, head-to-head).
 * Swap implementations without touching the engine: Sportradar (paid), public feeds, or your own scraper.
 *
 * Licensing note: DVOA (FTN) and Sportradar are commercial products. Only wire them in under a valid license.
 */
import type { LeagueId, MatchupFactors, WeatherContext } from "@/types/sports";
import { cached } from "@/lib/cache";

export interface StatsProvider {
  name: string;
  supports(league: LeagueId): boolean;
  getMatchupFactors(league: LeagueId, matchupId: string): Promise<MatchupFactors | null>;
}

/** Sportradar adapter skeleton: fill in the per-sport endpoints for your access level. */
export class SportradarProvider implements StatsProvider {
  name = "sportradar";
  constructor(private apiKey = process.env.SPORTRADAR_API_KEY, private level = process.env.SPORTRADAR_ACCESS_LEVEL ?? "trial") {}
  supports(): boolean {
    return Boolean(this.apiKey);
  }
  async getMatchupFactors(league: LeagueId, matchupId: string): Promise<MatchupFactors | null> {
    if (!this.apiKey) return null;
    // e.g. NFL: https://api.sportradar.com/nfl/official/{level}/v7/en/games/{id}/summary.json
    // Map team efficiency, injuries and schedule into MatchupFactors here.
    void league; void matchupId; void this.level;
    return null;
  }
}

/** Free kickoff weather from Open-Meteo (no key). */
export async function getKickoffWeather(lat: number, lon: number, isoStart: string): Promise<WeatherContext | null> {
  const hour = isoStart.slice(0, 13) + ":00";
  return cached(`wx:${lat.toFixed(2)}:${lon.toFixed(2)}:${hour}`, 1800, async () => {
    const qs = new URLSearchParams({
      latitude: String(lat), longitude: String(lon), timezone: "UTC", forecast_days: "7",
      hourly: "temperature_2m,precipitation_probability,wind_speed_10m", temperature_unit: "fahrenheit", wind_speed_unit: "mph",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`);
    if (!res.ok) return null;
    const d = (await res.json()) as { hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; wind_speed_10m: number[] } };
    const i = d.hourly.time.indexOf(hour);
    if (i < 0) return null;
    return {
      temperatureF: d.hourly.temperature_2m[i], windMph: d.hourly.wind_speed_10m[i],
      precipitationChance: d.hourly.precipitation_probability[i] / 100, conditions: "Forecast",
    };
  });
}

export const providers: StatsProvider[] = [new SportradarProvider()];
