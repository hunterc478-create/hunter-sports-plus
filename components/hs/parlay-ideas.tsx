"use client";
/**
 * Parlay ideas: always a full set, built from legs our model rates likely (55%+, -250 to +120), mixing game lines,
 * props and alt props from different games. Random but seeded by the data update, so everyone sees the same set
 * until the next update; Shuffle deals a new set.
 */
import { useMemo, useState } from "react";
import { Shuffle } from "lucide-react";
import { useSlip } from "@/lib/my-bets";
import { parlayDecimal } from "@/lib/odds-math";
import { cn, fmtAmerican } from "@/lib/utils";
import { altUnderTip, PropTag, propType, rank, type BetRow } from "./bet-list";
import { likelyScore, isLockLeg, lockCombos } from "@/lib/ours";

const SIZES = [2, 2, 3, 3, 3, 4, 4, 5, 3, 4];

/** Small seeded random generator (mulberry32) so a set is stable for a given seed. */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/** Pick n legs from different games, favoring higher chances (weight = our chance squared). */
function deal(pool: (BetRow & { our: number })[], n: number, rand: () => number) {
  const legs: (BetRow & { our: number })[] = [];
  const games = new Set<string>();
  for (let tries = 0; legs.length < n && tries < 200; tries++) {
    const open = pool.filter((r) => !games.has(r.card.matchup.id));
    if (!open.length) break;
    const total = open.reduce((s, r) => s + r.our ** 2, 0);
    let x = rand() * total;
    const pick = open.find((r) => (x -= r.our ** 2) <= 0) ?? open[open.length - 1];
    legs.push(pick);
    games.add(pick.card.matchup.id);
  }
  return legs.length === n ? legs : null;
}

/** Moneyline parlays: teams our model rates 55%+ to win, priced -400 to +120 (stacked favorites still pay). */
const mlPool = (rows: BetRow[]) => rows.filter((r): r is BetRow & { our: number } => r.kind === "Moneyline" && r.our !== undefined && r.our >= 0.55 && r.odds >= -400 && r.odds <= 120)
  .sort((a, b) => b.our - a.our);

type Leg = BetRow & { our: number };

/** Most confident: the 2- and 3-leg combos (different games) with the highest combined chance. Legs: anything both we
 * (63%+) and the books (58%+) like, plus main-line props we rate 58%+ that the books have at 50%+ (they're priced near
 * -115, so the books never rate them 60%). Ranked on the average of our chance and the books', so a leg the model loves
 * but the books don't (usually a projection miss on a fringe player) doesn't float to the top. At least 5 parlays carry
 * a main-line prop; no leg appears in more than two parlays. */
const sureness = (l: Leg) => (likelyScore(l) + l.books) / 2;
const isMain = (l: Leg) => l.kind === "Prop";
function confident(pool: Leg[], count: number): Leg[][] {
  const bySure = (a: Leg, b: Leg) => sureness(b) - sureness(a);
  const strong = pool.filter((r) => r.our >= 0.63 && r.books >= 0.58).sort(bySure).slice(0, 16);
  const main = pool.filter((r) => isMain(r) && r.our >= 0.58 && r.books >= 0.5 && !strong.includes(r)).sort(bySure).slice(0, 8);
  const top = [...strong, ...main];
  const combos: Leg[][] = [];
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    if (top[i].card.matchup.id === top[j].card.matchup.id) continue;
    combos.push([top[i], top[j]]);
    for (let k = j + 1; k < top.length; k++) {
      const g = new Set([top[i], top[j], top[k]].map((l) => l.card.matchup.id));
      if (g.size === 3) combos.push([top[i], top[j], top[k]]);
    }
  }
  const p = (ls: Leg[]) => ls.reduce((x, l) => x * sureness(l), 1);
  combos.sort((a, b) => p(b) - p(a));
  const used = new Map<string, number>(), out: Leg[][] = [];
  const take = (ok: (c: Leg[]) => boolean, want: number) => {
    for (const c of combos) {
      if (out.length >= want) break;
      if (!ok(c) || out.includes(c) || c.some((l) => (used.get(l.key) ?? 0) >= 2)) continue;
      c.forEach((l) => used.set(l.key, (used.get(l.key) ?? 0) + 1));
      out.push(c);
    }
  };
  const mainCount = Math.min(5, count);
  take((c) => c.some(isMain) && c.length === 2, Math.ceil(mainCount / 2));   // main-line props first, so they always show
  take((c) => c.some(isMain) && c.length === 3, mainCount);
  take((c) => c.length === 2, Math.ceil((count + out.length) / 2));            // then the safest of everything, half doubles
  take((c) => c.length === 3, count);
  take(() => true, count);
  return out.sort((a, b) => p(b) - p(a));
}

export function ParlayIdeas({ rows, seed, count = 8, mode = "mixed" }: { rows: BetRow[]; seed: string; count?: number; mode?: "mixed" | "ml" | "sure" | "locks" }) {
  const [shuffles, setShuffles] = useState(0);
  const slip = useSlip();
  const [added, setAdded] = useState<number | null>(null);
  const pool = useMemo(() => (mode === "ml" ? mlPool(rows) : mode === "locks" ? rows.filter((r): r is BetRow & { our: number } => isLockLeg(r)) : rank(rows, "likely") as (BetRow & { our: number })[]), [rows, mode]);
  const parlays = useMemo(() => {
    if (mode === "sure") return confident(pool, count);
    if (mode === "locks") return lockCombos(pool, (r) => r.card.matchup.id);
    const rand = rng(hash(seed) + shuffles * 7919);
    const out: (BetRow & { our: number })[][] = [];
    const seen = new Set<string>();
    for (const n of SIZES) {
      if (out.length >= count) break;
      for (let t = 0; t < 6; t++) {
        const legs = deal(pool, n, rand);
        if (!legs) break;
        const key = legs.map((l) => l.key).sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key); out.push(legs); break;
      }
    }
    return out;
  }, [pool, seed, shuffles, count, mode]);

  if (mode === "locks" && parlays.length === 0) return <p className="rounded-lg border border-dashed border-slate-line bg-slate-card p-6 text-center text-sm text-muted-foreground">No lock parlay right now: it needs two games with a heavy favorite (-150 to -400) that both we and the books rate 70%+ and that still beats its price. Skipping is the right call on days like this.</p>;
  if (pool.length < 2) return <p className="rounded-lg border border-dashed border-slate-line bg-slate-card p-6 text-center text-sm text-muted-foreground">Not enough games with lines yet to build parlays. They fill in as the week&apos;s lines post.</p>;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{mode === "locks" ? "Heavy favorites (-150 to -400) both we and the books rate 70%+, that still beat their price. Nothing is truly a lock: two 75% legs hit together about 56% of the time." : mode === "ml" ? "Moneylines from different games, each team our model rates 55%+ to win." : mode === "sure" ? "Our safest combos, ranked by the chance the whole parlay hits: legs both we and the books like, plus main-line props you can bet anywhere." : "Legs from different games, each one our model rates 55%+ to hit."}</p>
        {mode !== "sure" && mode !== "locks" && <button type="button" onClick={() => { setShuffles(shuffles + 1); setAdded(null); }} className="inline-flex items-center gap-1.5 rounded-md border border-slate-line px-3 py-1.5 text-xs font-bold hover:bg-slate-raised">
          <Shuffle className="h-3.5 w-3.5" /> Shuffle
        </button>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {parlays.map((legs, i) => {
          const dec = parlayDecimal(legs.map((l) => l.odds));
          const our = legs.reduce((p, l) => p * l.our, 1);
          const books = legs.reduce((p, l) => p * l.books, 1);
          return (
            <div key={i} className="rounded-xl border border-slate-line bg-slate-card p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{legs.length}-leg parlay</div>
                <div className="text-2xl font-black tabular-nums text-brand">{fmtAmerican(dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1)))}</div>
              </div>
              <ol className="space-y-1.5 text-sm">
                {legs.map((l) => (
                  <li key={l.key} className="flex items-start justify-between gap-2">
                    <span className="min-w-0"><span className="font-semibold">{l.label}</span><span className="block text-[11px] text-muted-foreground"><PropTag type={propType(l)} />{l.card.matchup.league} · {l.card.matchup.away.shortName} @ {l.card.matchup.home.shortName}{propType(l) ? "" : ` · ${l.kind}`} · {l.book}</span>{propType(l) === "altUnder" && <span className="block text-[11px] text-warn/90">{altUnderTip(l.book)}</span>}</span>
                    <span className="shrink-0 text-right tabular-nums"><b>{fmtAmerican(l.odds)}</b><span className="block text-[11px] text-muted-foreground">{Math.round(l.our * 100)}%</span></span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-line pt-2.5 text-xs">
                <span className="text-muted-foreground">Our chance <b className="text-ink">{Math.round(our * 100)}%</b> · books {Math.round(books * 100)}%</span>
                <button type="button" onClick={() => { slip.replace(legs.map((l) => l.leg)); setAdded(i); }}
                  className={cn("rounded-md px-3 py-1.5 font-bold", added === i ? "bg-neon/15 text-neon" : "bg-brand text-obsidian hover:opacity-90")}>
                  {added === i ? "✓ In your slip" : "Add to slip"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Chances multiply: four 65% legs hit together about 18% of the time. Our chances come from our own model; check prices at your book before betting.</p>
    </div>
  );
}
