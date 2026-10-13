/** Free geocoding + kickoff weather from Open-Meteo (no key), used for travel and weather factors. */
import type { WeatherContext } from "@/types/sports";
import { getJson } from "./http";

export interface Place { lat: number; lon: number; tz: string; elevationM: number }
const geoCache = new Map<string, Promise<Place | null>>();

export function geocode(name?: string): Promise<Place | null> {
  if (!name) return Promise.resolve(null);
  const key = name.toLowerCase();
  if (!geoCache.has(key)) {
    geoCache.set(key, (async () => {
      const d = await getJson<{ results?: { latitude: number; longitude: number; timezone: string; elevation?: number }[] }>(
        "https://geocoding-api.open-meteo.com/v1/search", { name, count: 1, language: "en", format: "json" });
      const r = d?.results?.[0];
      return r ? { lat: r.latitude, lon: r.longitude, tz: r.timezone, elevationM: r.elevation ?? 0 } : null;
    })());
  }
  return geoCache.get(key)!;
}

export function milesBetween(a: Place, b: Place): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return Math.round(3959 * 2 * Math.asin(Math.sqrt(h)));
}

export function tzOffsetHours(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at);
  const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = off.match(/GMT([+-]\d+)(?::(\d+))?/);
  return m ? Number(m[1]) + (m[2] ? Math.sign(Number(m[1])) * Number(m[2]) / 60 : 0) : 0;
}

const wxCache = new Map<string, Promise<WeatherContext | undefined>>();
export function kickoffWeather(place: Place, startIso: string): Promise<WeatherContext | undefined> {
  const hour = new Date(startIso).toISOString().slice(0, 13) + ":00";
  const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)},${hour}`;
  if (!wxCache.has(key)) {
    wxCache.set(key, (async () => {
      const d = await getJson<{ hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; wind_speed_10m: number[] } }>(
        "https://api.open-meteo.com/v1/forecast", {
          latitude: place.lat, longitude: place.lon, timezone: "UTC", forecast_days: 8,
          hourly: "temperature_2m,precipitation_probability,wind_speed_10m", temperature_unit: "fahrenheit", wind_speed_unit: "mph",
        });
      const i = d?.hourly?.time.indexOf(hour) ?? -1;
      if (!d?.hourly || i < 0) return undefined;
      return {
        temperatureF: d.hourly.temperature_2m[i], windMph: d.hourly.wind_speed_10m[i],
        precipitationChance: (d.hourly.precipitation_probability[i] ?? 0) / 100, conditions: "Forecast",
      };
    })());
  }
  return wxCache.get(key)!;
}
