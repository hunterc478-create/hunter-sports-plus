"use client";
/** Polls /api/odds on an interval and pauses while the tab is hidden. Swap for a WebSocket when your feed supports one. */
import { useEffect, useState } from "react";
import type { LeagueId } from "@/types/sports";

export function useLiveOdds(league: LeagueId, intervalSec = Number(process.env.NEXT_PUBLIC_ODDS_POLL_SECONDS ?? 45)) {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/odds?league=${league}`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) setError(json.error ?? `HTTP ${res.status}`);
        else { setData(json); setError(null); setUpdatedAt(new Date()); }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    load();
    const t = setInterval(load, intervalSec * 1000);
    document.addEventListener("visibilitychange", load);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", load); };
  }, [league, intervalSec]);

  return { data, error, updatedAt };
}
