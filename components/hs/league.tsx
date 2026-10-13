"use client";
/**
 * Sport switch: which sport every list shows ("All" = the whole slate). Each sport has its own accent color, set as the
 * --brand CSS variable so buttons, tabs and highlights follow the sport you're on. Remembered on this device.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { LeagueId } from "@/types/sports";
import { cn } from "@/lib/utils";

export type Lg = "ALL" | "NBA" | "NHL" | "MLB" | "CBB" | "SOCCER" | "TENNIS" | "WNBA";

/** label, accent (R G B), and the leagues in the group */
export const SPORTS: Record<Lg, { label: string; rgb: string; leagues: LeagueId[] }> = {
  ALL: { label: "All", rgb: "45 212 191", leagues: [] },
  NBA: { label: "NBA", rgb: "251 191 36", leagues: ["NBA"] },
  NHL: { label: "NHL", rgb: "96 165 250", leagues: ["NHL"] },
  MLB: { label: "MLB", rgb: "129 140 248", leagues: ["MLB"] },
  CBB: { label: "College BB", rgb: "244 114 182", leagues: ["NCAAB", "NCAAW"] },
  SOCCER: { label: "Soccer", rgb: "163 230 53", leagues: ["EPL", "UCL", "LALIGA", "SERIEA", "BUNDESLIGA", "LIGUE1", "MLS"] },
  TENNIS: { label: "Tennis", rgb: "226 243 91", leagues: ["ATP", "WTA"] },
  WNBA: { label: "WNBA", rgb: "251 113 133", leagues: ["WNBA"] },
};
export const ORDER: Lg[] = ["ALL", "NBA", "NHL", "MLB", "CBB", "SOCCER", "TENNIS", "WNBA"];

/** Whether a league belongs to the selected sport. */
export const inLg = (league: string, lg: Lg) => lg === "ALL" || SPORTS[lg].leagues.includes(league as LeagueId);
/** The sport group a league is in (for its color). */
export const groupOf = (league: string): Lg => ORDER.find((g) => g !== "ALL" && SPORTS[g].leagues.includes(league as LeagueId)) ?? "ALL";
/** A league's accent as a CSS color, with optional alpha. */
export const sportColor = (league: string, a = 1) => `rgb(${SPORTS[groupOf(league)].rgb} / ${a})`;

const Ctx = createContext<{ league: Lg; setLeague: (l: Lg) => void }>({ league: "ALL", setLeague: () => {} });
const KEY = "hsp-sport";

export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const [league, set] = useState<Lg>("ALL");
  useEffect(() => { try { const v = localStorage.getItem(KEY) as Lg | null; if (v && v in SPORTS) set(v); } catch {} }, []);
  useEffect(() => { document.documentElement.style.setProperty("--brand", SPORTS[league].rgb); }, [league]);
  const setLeague = (l: Lg) => { set(l); try { localStorage.setItem(KEY, l); } catch {} };
  return <Ctx.Provider value={{ league, setLeague }}>{children}</Ctx.Provider>;
}

export const useLeague = () => useContext(Ctx);

export function LeagueSwitch({ className }: { className?: string }) {
  const { league, setLeague } = useLeague();
  return (
    <div role="group" aria-label="Sport" className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 text-xs font-bold", className)}>
      {ORDER.map((k) => (
        <button key={k} type="button" aria-pressed={league === k} onClick={() => setLeague(k)}
          style={league === k ? { background: `rgb(${SPORTS[k].rgb})` } : { borderColor: `rgb(${SPORTS[k].rgb} / 0.45)` }}
          className={cn("shrink-0 rounded-full border px-3 py-1.5", league === k ? "border-transparent text-obsidian" : "text-ink/80 hover:text-ink")}>
          {SPORTS[k].label}
        </button>
      ))}
    </div>
  );
}
