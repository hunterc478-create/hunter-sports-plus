import { cn, fmtEdge } from "@/lib/utils";

export function EdgePill({ edge, className }: { edge: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold tabular-nums",
      edge >= 0.04 ? "bg-neon text-obsidian" : edge >= 0.02 ? "bg-neon/15 text-neon" : edge >= 0 ? "bg-slate-raised text-foreground" : "bg-loss/15 text-loss", className)}>
      {fmtEdge(edge)}
    </span>
  );
}
