"use client";
/**
 * Sport switch: which sport every list shows ("All" = the whole slate). Each sport has its own accent color, set as the
 * --brand CSS variable so buttons, tabs and highlights follow the sport you're on. Remembered on this device.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { LeagueId } from "@/types/sports";
import { cn } from "@/lib/utils";

export type Sport = "ALL" | "NBA" | "NHL" | "MLB" | "CBB" | "SOCCER" | "TENNIS" | "WNBA";
/** A sport group, or one league inside it (the league chips). */
export type Lg = Sport | LeagueId;

/** label, accent (R G B), and the leagues in the group */
export const SPORTS: Record<Sport, { label: string; rgb: string; leagues: LeagueId[] }> = {
  ALL: { label: "All", rgb: "45 212 191", leagues: [] },
  NBA: { label: "NBA", rgb: "251 191 36", leagues: ["NBA"] },
  NHL: { label: "NHL", rgb: "96 165 250", leagues: ["NHL"] },
  MLB: { label: "MLB", rgb: "129 140 248", leagues: ["MLB"] },
  CBB: { label: "College BB", rgb: "244 114 182", leagues: ["NCAAB", "NCAAW"] },
  SOCCER: { label: "Soccer", rgb: "163 230 53", leagues: ["EPL", "UCL", "LALIGA", "SERIEA", "BUNDESLIGA", "LIGUE1", "MLS"] },
  TENNIS: { label: "Tennis", rgb: "226 243 91", leagues: ["ATP", "WTA"] },
  WNBA: { label: "WNBA", rgb: "251 113 133", leagues: ["WNBA"] },
};
export const ORDER: Sport[] = ["ALL", "NBA", "NHL", "MLB", "CBB", "SOCCER", "TENNIS", "WNBA"];

/** Whether a league belongs to the selected sport. */
export const inLg = (league: string, lg: Lg) => lg === "ALL" || (lg in SPORTS ? SPORTS[lg as Sport].leagues.includes(league as LeagueId) : league === lg);
/** The sport group a league is in (for its color). */
export const groupOf = (league: string): Sport => ORDER.find((g) => g !== "ALL" && SPORTS[g].leagues.includes(league as LeagueId)) ?? "ALL";
/** A league's accent as a CSS color, with optional alpha. */
export const sportColor = (league: string, a = 1) => `rgb(${SPORTS[groupOf(league)].rgb} / ${a})`;

type Ctx = { league: Sport; setLeague: (l: Sport) => void; sub: LeagueId | "ALL"; setSub: (l: LeagueId | "ALL") => void; pick: Lg; counts: Record<string, number> };
const Ctx = createContext<Ctx>({ league: "ALL", setLeague: () => {}, sub: "ALL", setSub: () => {}, pick: "ALL", counts: {} });
const KEY = "hsp-sport", SUB = "hsp-league";

/** counts: today's games per league, for the league chips. */
export function LeagueProvider({ children, counts = {} }: { children: React.ReactNode; counts?: Record<string, number> }) {
  const [league, set] = useState<Sport>("ALL");
  const [sub, setS] = useState<LeagueId | "ALL">("ALL");
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY) as Sport | null; if (v && v in SPORTS) set(v);
      const s = localStorage.getItem(SUB) as LeagueId | null; if (s && v && v in SPORTS && SPORTS[v].leagues.includes(s)) setS(s);
    } catch {}
  }, []);
  useEffect(() => { document.documentElement.style.setProperty("--brand", SPORTS[league].rgb); }, [league]);
  const setLeague = (l: Sport) => { set(l); setS("ALL"); try { localStorage.setItem(KEY, l); localStorage.removeItem(SUB); } catch {} };
  const setSub = (l: LeagueId | "ALL") => { setS(l); try { if (l === "ALL") localStorage.removeItem(SUB); else localStorage.setItem(SUB, l); } catch {} };
  const pick: Lg = sub !== "ALL" && SPORTS[league].leagues.includes(sub) ? sub : league;
  return <Ctx.Provider value={{ league, setLeague, sub, setSub, pick, counts }}>{children}</Ctx.Provider>;
}

const SHORT: Partial<Record<LeagueId, string>> = { EPL: "Premier League", UCL: "Champions League", LALIGA: "La Liga", SERIEA: "Serie A", BUNDESLIGA: "Bundesliga", LIGUE1: "Ligue 1", MLS: "MLS", ATP: "ATP (men)", WTA: "WTA (women)", NCAAB: "Men's", NCAAW: "Women's" };

/** Second row: the leagues inside the selected sport, with today's game counts. */
function LeagueChips() {
  const { league, sub, setSub, counts } = useLeague();
  const list = SPORTS[league].leagues;
  if (list.length < 2) return null;
  const total = list.reduce((s, l) => s + (counts[l] ?? 0), 0);
  const chip = (k: LeagueId | "ALL", label: string, n: number) => (
    <button key={k} type="button" aria-pressed={sub === k} onClick={() => setSub(k)}
      className={cn("shrink-0 rounded-md border px-2.5 py-1", sub === k ? "border-brand bg-brand/15 text-brand" : "border-slate-line text-ink/70 hover:text-ink", !n && sub !== k && "opacity-50")}>
      {label} <span className="tabular-nums text-muted-foreground">{n}</span>
    </button>
  );
  return (
    <div role="group" aria-label="League" className="-mx-1 mt-1.5 flex gap-1.5 overflow-x-auto px-1 pb-1 text-[11px] font-bold">
      {chip("ALL", `All ${SPORTS[league].label.toLowerCase()}`, total)}
      {[...list].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0)).map((l) => chip(l, SHORT[l] ?? l, counts[l] ?? 0))}
    </div>
  );
}

export const useLeague = () => useContext(Ctx);

export function LeagueSwitch({ className }: { className?: string }) {
  const { league, setLeague } = useLeague();
  return (
    <div className={className}>
    <div role="group" aria-label="Sport" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 text-xs font-bold">
      {ORDER.map((k) => (
        <button key={k} type="button" aria-pressed={league === k} onClick={() => setLeague(k)}
          style={league === k ? { background: `rgb(${SPORTS[k].rgb})` } : { borderColor: `rgb(${SPORTS[k].rgb} / 0.45)` }}
          className={cn("shrink-0 rounded-full border px-3 py-1.5", league === k ? "border-transparent text-obsidian" : "text-ink/80 hover:text-ink")}>
          {SPORTS[k].label}
        </button>
      ))}
    </div>
    <LeagueChips />
    </div>
  );
}
