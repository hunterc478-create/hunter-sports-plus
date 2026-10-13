"use client";
import { useEffect } from "react";
import type { GameResults, TrackedPick } from "@/types/sports";
import { autoGrade, profitOf, useMyBets, type MyBet, type PropResultMap } from "@/lib/my-bets";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, fmtAmerican, fmtKickoff, fmtPct } from "@/lib/utils";

const money = (x: number) => `${x < 0 ? "-" : x > 0 ? "+" : ""}$${Math.abs(x).toFixed(2)}`;

/** Your own bets (saved in this browser), settled automatically when the site has graded the same pick. */
export function MyBetsView() {
  const { bets, update, remove } = useMyBets();

  // settle open bets from final scores (and the site's graded props); runs once per page load
  const openCount = bets.filter((b) => !b.result).length;
  useEffect(() => {
    if (!openCount) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const get = <T,>(f: string, empty: T) => fetch(`${base}/data/${f}?t=${Date.now()}`).then((r) => (r.ok ? r.json() : empty)).catch(() => empty) as Promise<T>;
    let cancelled = false;
    Promise.all([get<GameResults>("results.json", {}), get<TrackedPick[]>("history.json", []), get<PropResultMap>("prop-results.json", {})]).then(([results, history, props]) => {
      if (cancelled) return;
      for (const g of autoGrade(bets, results, history, props)) update(g.id, g.patch);
    });
    return () => { cancelled = true; };
  }, [openCount > 0]);

  const settled = bets.filter((b) => b.result);
  const wins = settled.filter((b) => b.result === "win").length;
  const losses = settled.filter((b) => b.result === "loss").length;
  const staked = settled.filter((b) => b.result !== "push").reduce((s, b) => s + b.stake, 0);
  const profit = settled.reduce((s, b) => s + profitOf(b), 0);
  const open = bets.filter((b) => !b.result).sort((a, b) => a.start.localeCompare(b.start));
  const done = settled.sort((a, b) => b.start.localeCompare(a.start));

  return (
    <>
      <PageHeader title="My bets" subtitle="Bets you've tracked with + Track, and parlays saved from the parlay slip. Spreads, totals and moneylines settle automatically from final scores; props from official player stats (usually the morning after). Saved in this browser only, so they won't show on your other devices." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Record" value={`${wins}-${losses}`} />
        <Stat label="Profit" value={money(profit)} tone={profit < 0 ? "text-loss" : profit > 0 ? "text-neon" : ""} />
        <Stat label="Staked (settled)" value={`$${staked.toFixed(2)}`} />
        <Stat label="ROI" value={staked ? fmtPct(profit / staked) : "—"} />
      </div>
      {bets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-line p-8 text-center text-sm text-muted-foreground">
          No tracked bets yet. Tap <b className="text-foreground">+ Track</b> next to a pick on +EV Picks or Locks.
        </div>
      ) : (
        <div className="space-y-6">
          {open.length > 0 && <Section title={`Open (${open.length})`} bets={open} update={update} remove={remove} />}
          {done.length > 0 && <Section title={`Settled (${done.length})`} bets={done} update={update} remove={remove} />}
        </div>
      )}
    </>
  );
}

function Section({ title, bets, update, remove }: { title: string; bets: MyBet[]; update: (id: string, p: Partial<MyBet>) => void; remove: (id: string) => void }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold">{title}</h2>
      <Card>
        <CardContent className="divide-y divide-slate-line p-0">
          {bets.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-semibold">{b.label} <span className="font-normal tabular-nums text-muted-foreground">{fmtAmerican(b.americanOdds)}</span></div>
                {b.kind === "parlay" && b.legs ? (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {b.legs.map((l) => (
                      <li key={l.id} className="flex items-center gap-1.5">
                        <span className={cn("w-9 shrink-0 text-[10px] font-semibold uppercase", l.result === "win" ? "text-neon" : l.result === "loss" ? "text-loss" : "text-muted-foreground")}>{l.result ?? "open"}</span>
                        <span className="truncate">{l.label}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{fmtAmerican(l.americanOdds)}{l.game && ` · ${l.game}`}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-muted-foreground">{b.league && <Badge variant="outline" className="mr-1.5">{b.league}</Badge>}{b.game}{b.start && ` · ${fmtKickoff(b.start)}`}</div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-muted-foreground">$
                  <input type="number" min={0} step={1} value={b.stake} aria-label="Stake in dollars"
                    onChange={(e) => update(b.id, { stake: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-16 rounded-md border border-slate-line bg-transparent px-1.5 py-1 text-right text-sm tabular-nums text-foreground" />
                </label>
                {b.result ? (
                  <>
                    <Badge variant={b.result === "win" ? "default" : b.result === "loss" ? "loss" : "secondary"} className="capitalize">{b.result}{b.auto ? " (auto)" : ""}</Badge>
                    <span className={cn("w-20 text-right font-semibold tabular-nums", profitOf(b) < 0 ? "text-loss" : profitOf(b) > 0 ? "text-neon" : "")}>{money(profitOf(b))}</span>
                    <button type="button" onClick={() => update(b.id, { result: undefined, auto: undefined })} className="text-xs text-muted-foreground underline-offset-2 hover:underline">undo</button>
                  </>
                ) : (
                  (["win", "loss", "push"] as const).map((r) => (
                    <button key={r} type="button" onClick={() => update(b.id, { result: r, auto: false })}
                      className="rounded-md border border-slate-line px-2 py-1 text-xs font-semibold capitalize hover:bg-slate-raised">{r === "win" ? "Won" : r === "loss" ? "Lost" : "Push"}</button>
                  ))
                )}
                <button type="button" onClick={() => remove(b.id)} aria-label={`Remove ${b.label}`} className="px-1 text-muted-foreground hover:text-loss">×</button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-line bg-slate-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-bold tabular-nums", tone)}>{value}</div>
    </div>
  );
}
