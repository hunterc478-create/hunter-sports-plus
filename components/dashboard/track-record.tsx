import type { TrackedPick, TrackRecordSummary } from "@/types/sports";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, fmtAmerican, fmtPct, fmtUnits } from "@/lib/utils";

export function TrackRecord({ summary, recent, legacy, paused = [] }: { summary: TrackRecordSummary; recent: TrackedPick[]; legacy?: TrackRecordSummary; paused?: string[] }) {
  const types = Object.entries(summary.byType ?? {}).sort((a, b) => b[1].picks - a[1].picks);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transparency log</CardTitle>
        <CardDescription>
          Every recommendation (game picks, alt lines, alt props and parlays) is logged about two hours before start at the
          posted price and graded automatically. Nothing gets deleted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {types.length > 0 && (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2 font-medium">Bet type</th><th className="pb-2 text-right font-medium">Record</th><th className="pb-2 text-right font-medium">ROI</th><th className="pb-2 text-right font-medium" title="Share of picks whose price beat the final pregame price">Beat close</th></tr></thead>
              <tbody>
                {types.map(([k, v]) => (
                  <tr key={k} className="border-t border-slate-line">
                    <td className="py-2">{k}{paused.includes(k) && <Badge variant="warn" className="ml-2">paused</Badge>}</td>
                    <td className="py-2 text-right tabular-nums">{v.wins}-{v.losses}</td>
                    <td className={cn("py-2 text-right tabular-nums", v.roi >= 0 ? "text-neon" : "text-loss")}>{fmtPct(v.roi)}</td>
                    <td className={cn("py-2 text-right tabular-nums", v.clv === null ? "text-muted-foreground" : v.clv >= 0.5 ? "text-neon" : v.clv < 0.35 ? "text-loss" : "")}>{v.clv === null ? "—" : fmtPct(v.clv, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              &quot;Beat close&quot; is the best early signal: above 50% means the market tends to move toward our picks after we make them.
              A bet type that stays under 35% over 20+ picks gets paused automatically.
            </p>
          </div>
        )}
        {!types.length && <p className="mb-4 text-sm text-muted-foreground">No graded picks for the current model yet. Picks are logged about two hours before each game.</p>}
        <ul className="divide-y divide-slate-line text-sm">
          {recent.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Badge variant={p.result === "win" ? "default" : p.result === "loss" ? "loss" : "secondary"} className="w-12 justify-center capitalize">{p.result}</Badge>
                <span className="truncate">{p.league} {p.label}</span>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {fmtAmerican(p.americanOdds)}{p.closingOdds != null && <> → {fmtAmerican(p.closingOdds)}</>}{" "}
                <b className={cn((p.profitUnits ?? 0) >= 0 ? "text-neon" : "text-loss")}>{fmtUnits(p.profitUnits ?? 0)}</b>
              </span>
            </li>
          ))}
        </ul>
        {legacy && legacy.picks > 0 && (
          <p className="mt-4 rounded-lg border border-slate-line p-3 text-xs text-muted-foreground">
            Earlier model versions (before today&apos;s fixes): {legacy.wins}-{legacy.losses}, {fmtUnits(legacy.unitsProfit)} ({fmtPct(legacy.roi)} ROI).
            Kept for the record, but not counted above, since those picks came from math that has since been corrected.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">The arrow shows posted price → closing price.</p>
      </CardContent>
    </Card>
  );
}
