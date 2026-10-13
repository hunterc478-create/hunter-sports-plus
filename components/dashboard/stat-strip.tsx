import type { DashboardData } from "@/types/sports";
import { fmtPct, fmtUnits } from "@/lib/utils";

export function StatStrip({ data }: { data: DashboardData }) {
  const avgEv = data.topPicks.length ? data.topPicks.reduce((s, b) => s + b.expectedValue, 0) / data.topPicks.length : 0;
  const t = data.trackRecord;
  const small = t.picks < 30;
  const stats: { label: string; value: string; tone?: boolean; sub?: string }[] = [
    { label: "Picks on the board", value: String(data.topPicks.length) },
    { label: "Average EV", value: data.topPicks.length ? `${avgEv >= 0 ? "+" : ""}${(avgEv * 100).toFixed(1)}%` : "—" },
    { label: "Record", value: `${t.wins}-${t.losses}${t.pushes ? `-${t.pushes}` : ""}` },
    { label: "Units", value: fmtUnits(t.unitsProfit), tone: t.unitsProfit >= 0 },
    { label: "ROI", value: t.picks ? fmtPct(t.roi) : "—", tone: t.picks ? t.roi >= 0 : undefined, sub: small && t.picks ? `small sample (${t.picks} ${t.picks === 1 ? "pick" : "picks"})` : undefined },
    { label: "Beat the closing line", value: t.closingSample ? fmtPct(t.closingLineValueRate, 0) : "—", sub: t.closingSample ? undefined : "no closing prices yet" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-line bg-slate-line sm:grid-cols-3 xl:grid-cols-6">
      {stats.map((s) => (
        <div key={s.label} className="bg-slate-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{s.label}</dt>
          <dd className={`mt-1 text-xl font-bold tabular-nums ${s.tone === undefined ? "" : s.tone ? "text-neon" : "text-loss"}`}>{s.value}</dd>
          {s.sub && <dd className="text-[11px] text-muted-foreground">{s.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
