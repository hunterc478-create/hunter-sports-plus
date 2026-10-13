import type { ModelCheck as Check } from "@/types/sports";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MODEL_CHECK_MIN } from "@/lib/engine/track-record";
import { cn, fmtPct } from "@/lib/utils";

const VERDICT: Record<Check["verdict"], { title: string; body: string; tone: string }> = {
  too_early: { title: "Too early to tell", body: `Under ${MODEL_CHECK_MIN} graded straight bets, a hot or cold streak looks exactly like skill. Watch the closing-line number below; it settles first.`, tone: "text-muted-foreground" },
  overconfident: { title: "Overconfident", body: "The model's picks are hitting clearly less often than it says they will: more than bad luck explains. Its edges are probably smaller than shown.", tone: "text-loss" },
  underconfident: { title: "Underconfident", body: "The picks are hitting clearly more often than the model predicted. Good problem, but its chances are too timid.", tone: "text-warn" },
  on_track: { title: "On track", body: "Wins are landing within normal luck of what the model predicted, so its hit chances can be taken roughly at face value.", tone: "text-neon" },
};

/** Calibration bars (actual hit rate, with a tick for the predicted rate) plus expected wins and closing-line value. */
export function ModelCheck({ check }: { check: Check }) {
  const v = VERDICT[check.verdict];
  const rows = check.buckets.filter((b) => b.picks > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Is the model any good?</CardTitle>
        <CardDescription>Straight bets from the current model (parlays left out). Two questions settle faster than a win-loss record: do its hit chances come true, and does the market move toward its picks?</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border border-slate-line p-3">
          <div className={cn("text-base font-bold", v.tone)}>{v.title}</div>
          <p className="mt-1 text-sm text-muted-foreground">{v.body}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Graded straight bets" value={`${check.picks}`} />
          <Stat label="Wins vs. expected" value={check.picks ? `${check.wins} vs ${check.expectedWins.toFixed(1)}` : "—"}
            hint="If the model's chances were exactly right, it would have won about this many." />
          <Stat label="Beat the closing price" value={check.beatCloseRate === null ? "—" : fmtPct(check.beatCloseRate, 0)}
            hint={check.avgClvPts === null ? "No closing prices yet." : `Average move ${check.avgClvPts >= 0 ? "toward" : "against"} our picks: ${Math.abs(check.avgClvPts * 100).toFixed(1)} pts over ${check.clvSample} bets. Above 50% / positive is the best early sign of real edge.`} />
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Does a 65% pick hit 65% of the time?</h3>
            <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-neon" />Actual hit rate</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-foreground" />Model predicted</span>
            </div>
          </div>
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">No graded straight bets yet.</p> : (
            <table className="w-full text-sm">
              <caption className="sr-only">Actual vs. predicted hit rate by the model&apos;s hit chance</caption>
              <thead><tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Model said</th><th className="pb-2 font-medium" /><th className="pb-2 text-right font-medium">Actual / predicted</th>
              </tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.label} className="group" title={`${b.label}: hit ${fmtPct(b.actual, 0)} of ${b.picks} bets; the model predicted ${fmtPct(b.predicted, 0)}`}>
                    <td className="w-20 py-1.5 pr-3 text-xs text-muted-foreground">{b.label}</td>
                    <td className="py-1.5">
                      <div className="relative h-4 rounded bg-slate-raised/60 group-hover:bg-slate-raised">
                        <div className="h-4 rounded-r bg-neon" style={{ width: `${b.actual * 100}%`, minWidth: b.actual > 0 ? 4 : 0 }} />
                        <div className="absolute -top-0.5 h-5 w-0.5 bg-foreground ring-2 ring-slate-card" style={{ left: `calc(${b.predicted * 100}% - 1px)` }} />
                      </div>
                    </td>
                    <td className="w-36 py-1.5 pl-3 text-right text-xs tabular-nums">
                      <b>{fmtPct(b.actual, 0)}</b> <span className="text-muted-foreground">/ {fmtPct(b.predicted, 0)} · {b.picks} bets</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Bars short of the tick mean the model was too confident in that range. Small groups swing a lot, so read the bigger rows first.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-line p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
