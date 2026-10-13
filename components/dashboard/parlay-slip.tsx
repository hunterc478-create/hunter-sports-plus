"use client";
import { useEffect, useState } from "react";
import { lastStake, slipMath, useMyBets, useSlip } from "@/lib/my-bets";
import { cn, fmtAmerican, fmtPct } from "@/lib/utils";

/**
 * Floating bet slip (bottom-right), shown on every page once it has a leg. Builds a parlay from + Parlay taps and
 * saves it to My Bets. Lives in this browser only.
 */
export function ParlaySlip() {
  const slip = useSlip();
  const mine = useMyBets();
  const [open, setOpen] = useState(true);
  const [stake, setStake] = useState(10);
  const [saved, setSaved] = useState(false);
  useEffect(() => setStake(lastStake()), []);
  // reopen when a leg is added
  useEffect(() => { if (slip.legs.length) { setOpen(true); setSaved(false); } }, [slip.legs.length]);

  if (!slip.legs.length && !saved) return null;
  const m = slipMath(slip.legs);
  const payout = stake * m.decimal;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 rounded-full lg:bottom-4 border border-neon/60 bg-obsidian px-4 py-2 text-sm font-semibold text-neon shadow-lg">
        Parlay slip · {slip.legs.length} {slip.legs.length === 1 ? "leg" : "legs"}{slip.legs.length >= 2 ? ` · ${fmtAmerican(m.american)}` : ""}
      </button>
    );
  }

  return (
    <aside aria-label="Parlay slip"
      className="fixed inset-x-4 bottom-20 z-40 max-h-[70vh] lg:bottom-4 overflow-y-auto rounded-xl border border-slate-line bg-slate-card shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[360px]">
      <div className="sticky top-0 flex items-center justify-between border-b border-slate-line bg-slate-card px-4 py-3">
        <div className="font-bold">Parlay slip <span className="text-sm font-normal text-muted-foreground">({slip.legs.length})</span></div>
        <div className="flex items-center gap-3 text-xs">
          {slip.legs.length > 0 && <button type="button" onClick={slip.clear} className="text-muted-foreground hover:text-loss">Clear</button>}
          <button type="button" onClick={() => { setOpen(false); if (!slip.legs.length) setSaved(false); }} aria-label="Minimize parlay slip" className="text-lg leading-none text-muted-foreground hover:text-foreground">–</button>
        </div>
      </div>

      {saved && !slip.legs.length ? (
        <p className="px-4 py-4 text-sm"><span className="font-semibold text-neon">Saved to My Bets.</span> <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/my-bets/`} className="underline underline-offset-2">View it</a></p>
      ) : (
        <div className="space-y-3 px-4 py-3">
          <ul className="space-y-2">
            {slip.legs.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-2 rounded-md bg-slate-raised/50 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{l.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{[l.league, l.game].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-muted-foreground">{fmtAmerican(l.americanOdds)}</span>
                  <button type="button" onClick={() => slip.remove(l.id)} aria-label={`Remove ${l.label}`} className="text-muted-foreground hover:text-loss">×</button>
                </div>
              </li>
            ))}
          </ul>

          {slip.legs.length < 2 ? (
            <p className="text-xs text-muted-foreground">Add at least one more leg with <b className="text-foreground">+ Parlay</b> on any pick.</p>
          ) : (
            <>
              {m.sameGame && <p className="rounded-md border border-warn/40 px-3 py-2 text-xs text-warn">Two or more legs are from the same game. They tend to win or lose together, so the real hit chance is lower (or higher) than shown, and many books won&apos;t allow it outside a same-game parlay.</p>}
              <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md border border-slate-line p-2"><dt className="text-muted-foreground">Odds</dt><dd className="text-base font-bold tabular-nums">{fmtAmerican(m.american)}</dd></div>
                <div className="rounded-md border border-slate-line p-2"><dt className="text-muted-foreground">Model hit</dt><dd className="text-base font-bold tabular-nums text-neon">{m.hit === null ? "—" : fmtPct(m.hit)}</dd></div>
                <div className="rounded-md border border-slate-line p-2"><dt className="text-muted-foreground">Book implied</dt><dd className="text-base font-bold tabular-nums">{fmtPct(m.implied)}</dd></div>
              </dl>
              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex items-center gap-1 text-muted-foreground">Stake $
                  <input type="number" min={0} step={1} value={stake} onChange={(e) => setStake(Math.max(0, Number(e.target.value) || 0))}
                    className="w-20 rounded-md border border-slate-line bg-transparent px-2 py-1 text-right tabular-nums text-foreground" />
                </label>
                <span className="tabular-nums">Pays <b className="text-neon">${payout.toFixed(2)}</b></span>
              </div>
              <button type="button" disabled={!stake}
                onClick={() => { mine.addParlay(slip.legs, stake); slip.clear(); setSaved(true); }}
                className={cn("w-full rounded-lg py-2 text-sm font-semibold", stake ? "bg-neon text-obsidian hover:bg-neon-dim" : "bg-slate-raised text-muted-foreground")}>
                Add to My Bets
              </button>
              <p className="text-[11px] text-muted-foreground">Settles automatically once every game is final. Saved on this device only.</p>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
