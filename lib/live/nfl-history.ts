/**
 * Real NFL results vs. the closing line (nflverse games data, 2010 on), for pricing alt spreads and totals.
 * NFL margins bunch up at 3 and 7, which a bell curve misses by up to ~5 points around 3-point favorites.
 * Probabilities are a weighted share of past games with a similar line (closer lines count more).
 */
import { execFile } from "node:child_process";

type G = { spread: number; result: number; totalLine: number; total: number };

export class NflHistory {
  private constructor(private games: G[]) {}

  static async load(): Promise<NflHistory | null> {
    const buf = await new Promise<Buffer | null>((resolve) => execFile("curl", ["-sS", "-L", "--fail", "--max-time", "60",
      "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"], { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 }, (e, out) => resolve(e ? null : out)));
    if (!buf) return null;
    const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean);
    const h = lines[0].split(",");
    const ix = (k: string) => h.indexOf(k);
    const [iS, iT, iSp, iR, iTl, iTo] = ["season", "game_type", "spread_line", "result", "total_line", "total"].map(ix);
    if ([iS, iT, iSp, iR].some((i) => i < 0)) return null;
    const games: G[] = [];
    for (const l of lines.slice(1)) {
      const c = l.split(",");
      if (c[iT] !== "REG" || Number(c[iS]) < 2010 || c[iSp] === "" || c[iR] === "" || c[iR] === "NA") continue;
      const g = { spread: Number(c[iSp]), result: Number(c[iR]), totalLine: Number(c[iTl]), total: Number(c[iTo]) };
      if ([g.spread, g.result].some((x) => !Number.isFinite(x))) continue;
      games.push(g, { ...g, spread: -g.spread, result: -g.result });   // mirror: every game seen from both sides
    }
    return games.length > 1000 ? new NflHistory(games) : null;
  }

  /** P(home margin > line) when the market expects the home team to win by `expected`. */
  pMarginOver(expected: number, line: number): number | null {
    return this.weighted((g) => Math.exp(-(((g.spread - expected) / 1.0) ** 2) / 2), (g) => g.result > line);
  }

  /** P(total points > line) when the market total is `expected`. */
  pTotalOver(expected: number, line: number): number | null {
    return this.weighted((g) => (Number.isFinite(g.totalLine) && Number.isFinite(g.total) ? Math.exp(-(((g.totalLine - expected) / 1.5) ** 2) / 2) : 0), (g) => g.total > line);
  }

  private weighted(w: (g: G) => number, hit: (g: G) => boolean): number | null {
    let sw = 0, sh = 0;
    for (const g of this.games) { const x = w(g); if (x < 1e-4) continue; sw += x; if (hit(g)) sh += x; }
    return sw >= 150 ? sh / sw : null;   // need enough similar games
  }
}
