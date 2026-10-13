import type { ConfidenceTier } from "@/types/sports";
import { cn } from "@/lib/utils";

const TIERS: ConfidenceTier[] = ["low", "medium", "high", "elite"];
const LABEL: Record<ConfidenceTier, string> = { low: "Low", medium: "Medium", high: "High", elite: "Elite" };

/** Four-segment meter: reads at a glance and doesn't pretend to more precision than the model has. */
export function ConfidenceMeter({ tier, className }: { tier: ConfidenceTier; className?: string }) {
  const level = TIERS.indexOf(tier);
  return (
    <div className={cn("flex items-center gap-2", className)} aria-label={`Confidence: ${LABEL[tier]}`}>
      <div className="flex gap-0.5">
        {TIERS.map((t, i) => (
          <span key={t} className={cn("h-3 w-1.5 rounded-sm", i <= level ? (level >= 2 ? "bg-neon" : "bg-warn") : "bg-slate-line")} />
        ))}
      </div>
      <span className="text-xs font-semibold text-muted-foreground">{LABEL[tier]}</span>
    </div>
  );
}
