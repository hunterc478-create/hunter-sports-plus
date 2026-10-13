"use client";
import type { MatchupCardData, Parlay } from "@/types/sports";
import { legFromParlayLeg, useSlip } from "@/lib/my-bets";

/** Loads a generated parlay into the bet slip (replacing what's there) so legs can be swapped before saving. */
export function OpenInBuilder({ parlay, matchups }: { parlay: Parlay; matchups: MatchupCardData[] }) {
  const slip = useSlip();
  const cards = new Map(matchups.map((m) => [m.matchup.id, m]));
  return (
    <button type="button" onClick={() => slip.replace(parlay.legs.map((l) => legFromParlayLeg(l, cards)))}
      className="mt-3 w-full rounded-lg border border-neon/50 py-1.5 text-xs font-semibold text-neon hover:bg-neon/10">
      Open in builder
    </button>
  );
}
