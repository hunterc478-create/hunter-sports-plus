import type { ValueBet } from "@/types/sports";
import { movedToward } from "@/lib/live/openers";
import { cn, fmtAmerican } from "@/lib/utils";

/** "Opened -110 → now -120 · market agrees": the market moving toward a pick is the best quick sign it's right. */
export function LineMove({ bet }: { bet: ValueBet }) {
  const o = bet.opening;
  if (!o) return null;
  const lineMoved = o.line !== undefined && bet.line !== undefined && o.line !== bet.line;
  const fmtLine = (x: number) => (bet.market === "spread" && x > 0 ? `+${x}` : `${x}`);
  const from = lineMoved ? fmtLine(o.line!) : fmtAmerican(o.americanOdds);
  const to = lineMoved ? fmtLine(bet.line!) : fmtAmerican(bet.bestQuote.americanOdds);
  const dir = movedToward(bet);
  if (from === to) return <div className="text-[11px] text-muted-foreground">No move since open</div>;
  return (
    <div className="text-[11px] text-muted-foreground" title={`First seen ${new Date(o.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}`}>
      Opened {from} → now {to}
      {dir !== null && <span className={cn("ml-1 font-semibold", dir ? "text-neon" : "text-warn")}>· {dir ? "market agrees" : "market moved away"}</span>}
    </div>
  );
}
