"use client";
import { useEffect, useState } from "react";
import type { LiveBundle } from "@/lib/live/assemble";

/** "Updated 4 min ago · Sources": how fresh the prices are, with the data-source list on tap. */
export function UpdateLine({ bundle }: { bundle: Pick<LiveBundle, "isMock" | "generatedAt" | "status"> }) {
  const [now, setNow] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const mins = now ? Math.max(0, Math.round((now - new Date(bundle.generatedAt).getTime()) / 60_000)) : null;
  const ago = mins === null ? "" : mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} hr ago` : `${Math.round(mins / 1440)} days ago`;
  const stale = !bundle.isMock && mins !== null && mins > 90;
  const failing = bundle.status.sources.filter((s) => !s.ok);
  return (
    <div className="mb-5 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${bundle.isMock || stale ? "bg-warn" : "bg-neon"}`} aria-hidden />
          {bundle.isMock ? "Sample data" : `Prices updated ${ago}`}{stale ? " (running late)" : ""}
        </span>
        {(bundle.status.sources.length > 0 || bundle.status.notes.length > 0) && (
          <button type="button" onClick={() => setOpen(!open)} className="underline-offset-2 hover:text-ink hover:underline">
            {failing.length ? `${failing.length} source issue${failing.length > 1 ? "s" : ""}` : "Sources"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 rounded-lg border border-slate-line bg-slate-card p-3">
          <ul className="grid gap-1 sm:grid-cols-2">
            {bundle.status.sources.map((s) => (
              <li key={s.name} className="flex justify-between gap-3"><span>{s.ok ? "✓" : "✕"} {s.name}</span><span>{s.detail}</span></li>
            ))}
          </ul>
          {bundle.status.notes.map((n) => <p key={n} className="mt-2">{n}</p>)}
        </div>
      )}
    </div>
  );
}
