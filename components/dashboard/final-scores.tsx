"use client";
import { useEffect, useState } from "react";
import type { GameResults, TrackedPick } from "@/types/sports";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const short = (name: string) => name.split(" ").slice(-1)[0];

/**
 * Finals from the last 24 hours (results.json), newest first. Games the site picked get its W/L, from the graded log.
 */
export function FinalScores({ graded }: { graded: TrackedPick[] }) {
  const [results, setResults] = useState<GameResults | null>(null);
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/data/results.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : {})).then(setResults).catch(() => setResults({}));
  }, []);
  if (!results) return null;
  const since = Date.now() - 24 * 3600_000;
  const games = Object.entries(results).filter(([, r]) => new Date(r.start).getTime() > since).sort((a, b) => b[1].start.localeCompare(a[1].start)).slice(0, 16);
  if (!games.length) return null;
  const pickOn = new Map<string, TrackedPick>();
  for (const p of graded) if (p.grade?.matchupId && p.kind !== "parlay" && !pickOn.has(p.grade.matchupId)) pickOn.set(p.grade.matchupId, p);
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-bold">Final scores <span className="text-sm font-normal text-muted-foreground">last 24 hours</span></h2>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {games.map(([id, r]) => {
          const p = pickOn.get(id);
          const awayWon = r.away > r.home;
          return (
            <li key={id} className="rounded-lg border border-slate-line bg-slate-card px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{id.split("-")[0]} · Final</span>
                {p && <Badge variant={p.result === "win" ? "default" : p.result === "loss" ? "loss" : "secondary"} className="capitalize" title={p.label}>Our pick: {p.result}</Badge>}
              </div>
              <div className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 tabular-nums">
                <span className={cn(awayWon ? "font-semibold" : "text-muted-foreground")}>{short(r.awayTeam)}</span><span className={cn(awayWon && "font-semibold")}>{r.away}</span>
                <span className={cn(!awayWon ? "font-semibold" : "text-muted-foreground")}>{short(r.homeTeam)}</span><span className={cn(!awayWon && "font-semibold")}>{r.home}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
