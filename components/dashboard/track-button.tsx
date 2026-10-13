"use client";
import { useState } from "react";
import type { MatchupCardData, ValueBet } from "@/types/sports";
import { legFromBet, useMyBets, useSlip } from "@/lib/my-bets";
import { cn } from "@/lib/utils";

const pill = "mt-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold";
const off = "border-slate-line text-muted-foreground hover:text-foreground";
const on = "border-neon/60 bg-neon/10 text-neon";

/** "+ Track" saves the pick to My Bets; "+ Parlay" adds it to the bet slip. Both toggle off on a second tap. */
export function TrackButton({ bet, card }: { bet: ValueBet; card?: MatchupCardData }) {
  const mine = useMyBets();
  const slip = useSlip();
  const [err, setErr] = useState<string | null>(null);
  const tracked = mine.has(bet.id);
  const inSlip = slip.has(bet.id);
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => (tracked ? mine.remove(bet.id) : mine.add(bet, card))} aria-pressed={tracked}
          title={tracked ? "Remove from My Bets" : "Add to My Bets (saved on this device)"} className={cn(pill, tracked ? on : off)}>
          {tracked ? "✓ Tracked" : "+ Track"}
        </button>
        <button type="button" aria-pressed={inSlip} title={inSlip ? "Remove from parlay slip" : "Add to parlay slip"} className={cn(pill, inSlip ? on : off)}
          onClick={() => { if (inSlip) { slip.remove(bet.id); setErr(null); } else setErr(slip.add(legFromBet(bet, card))); }}>
          {inSlip ? "✓ In parlay" : "+ Parlay"}
        </button>
      </div>
      {err && <p role="alert" className="mt-1 max-w-[220px] text-[11px] text-warn">{err}</p>}
    </div>
  );
}
