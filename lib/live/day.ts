/** Calendar-day helpers. Picks are grouped by the local day a game starts in DAY_TZ (default US Central). */
export const DAY_TZ = process.env.DAY_TZ || process.env.NEXT_PUBLIC_DAY_TZ || "America/Chicago";

export function dayKey(iso: string | Date, tz = DAY_TZ): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return dt.toISOString().slice(0, 10);
}

/** "Today", "Tomorrow", or "Sat 10/4" relative to `todayKey`. */
export function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return "Today";
  if (key === addDays(todayKey, 1)) return "Tomorrow";
  if (key === addDays(todayKey, -1)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${m}/${d}`;
}
