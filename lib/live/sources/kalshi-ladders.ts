/**
 * Kalshi ladders (free, no key):
 *   - player props, e.g. "Josh Allen: 250+ passing yards" -> graded against our own player projection
 *   - alt spreads, e.g. "Bills win by over 6.5"            -> graded against the game model's margin
 *   - alt totals, e.g. "Over 51.5 points"                   -> graded against the game model's total
 * Kalshi's market text isn't documented, so parsing is defensive and the Sources panel reports
 * how many rungs matched, plus an example of anything it couldn't read.
 */
import type { AltLine, LeagueId, MatchupCardData, PlayerProp, ValueBet } from "@/types/sports";
import { expectedValue, impliedProb, kellyFraction, normCdf, probToAmerican } from "@/lib/odds-math";
import { paramsFor } from "@/lib/engine/sport-params";
import { coverProb, overProb } from "@/lib/engine/probability";
import { MODEL_WEIGHT } from "@/lib/engine/value";
import { priceProp } from "@/lib/engine/props";
import { getJson } from "../http";
import { normTeam, sameTeam } from "../registry";
import type { NflPlayers, NflStat } from "../players/nfl";
import type { NflHistory } from "../nfl-history";
import { normName, toNflverseAbbr } from "../players/nfl";
type J = Record<string, any>;

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const FEE = Number(process.env.KALSHI_FEE ?? 0.07);
/** Props 8+ points off the market are usually a hot/cold streak or missing news, not value. */
export const PROP_GAP = 0.08;
const PREFIX: Partial<Record<LeagueId, string>> = { NFL: "KXNFL", NCAAF: "KXNCAAF", NBA: "KXNBA", NHL: "KXNHL", MLB: "KXMLB" };
const PROP_STATS: [RegExp, NflStat, string][] = [
  [/pass(ing)?\s*(yds|yards)|passyds/i, "passing_yards", "pass yds"],
  [/rush(ing)?\s*(yds|yards)|rshyds|rushyds/i, "rushing_yards", "rush yds"],
  [/rec(eiving)?\s*(yds|yards)|recyds/i, "receiving_yards", "rec yds"],
  [/pass(ing)?\s*(td|touchdown)|passtd/i, "passing_tds", "pass TDs"],
  [/anytime|touchdown|\btd\b|anytd/i, "anytime_td", "TDs"],
  [/receptions|\bnflrec\b/i, "receptions", "receptions"],
];

const ask = (m: J, side: "yes" | "no") => {
  const d = m[`${side}_ask_dollars`];
  const v = d !== undefined ? Number(d) : Number(m[`${side}_ask`]) / 100;
  return v > 0 && v < 1 ? v : undefined;
};
const withFee = (p: number) => probToAmerican(Math.min(0.99, p + FEE * p * (1 - p)));
const num = (s?: string) => { const m = s?.match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : undefined; };

let catalog: J[] | null = null;
async function seriesFor(league: LeagueId): Promise<J[]> {
  if (catalog === null) catalog = ((await getJson<J>(`${KALSHI}/series`, { category: "Sports" }))?.series ?? []) as J[];
  const pre = PREFIX[league];
  return pre ? catalog.filter((s) => String(s.ticker ?? "").toUpperCase().startsWith(pre)) : [];
}

/** Which game an event belongs to: both teams named in its title (abbreviation, nickname, or city). */
function gameFor(cards: MatchupCardData[], text: string): MatchupCardData | undefined {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, " ")} `;
  const hit = (team: { name: string; shortName: string; abbreviation?: string }) => {
    const n = normTeam(team.name), nick = normTeam(team.shortName);
    const city = n.replace(new RegExp(`\\s*${nick}$`), "").trim();
    return [team.abbreviation?.toLowerCase(), nick, city, n].filter((x) => x && x.length >= 2).some((x) => t.includes(` ${x} `));
  };
  return cards.find((c) => hit(c.matchup.home) && hit(c.matchup.away));
}

/** Which side a Kalshi team label ("Buffalo", "Kansas City", "BUF") refers to. */
function sideOf(c: MatchupCardData, label: string): "home" | "away" | null {
  const l = normTeam(label);
  for (const side of ["home", "away"] as const) {
    const t = c.matchup[side];
    if (sameTeam(label, t.name) || (t.abbreviation && l.split(" ").includes(t.abbreviation.toLowerCase())) || normTeam(t.name).startsWith(l + " ") || l.startsWith(normTeam(t.shortName))) return side;
  }
  return null;
}

export interface LadderResult { ladders: Map<string, ValueBet[]>; props: PlayerProp[]; diag: { name: string; ok: boolean; detail: string }[] }

export async function kalshiLadders(league: LeagueId, cards: MatchupCardData[], players: NflPlayers | null, outByTeam: Map<string, Set<string>>, history: NflHistory | null = null): Promise<LadderResult> {
  const out: LadderResult = { ladders: new Map(), props: [], diag: [] };
  const series = await seriesFor(league);
  if (!series.length) return out;
  const isGame = /GAME$/i;
  const spreadS = series.filter((s) => /SPREAD/i.test(s.ticker) || /spread|wins? by/i.test(s.title ?? ""));
  const totalS = series.filter((s) => /TOTAL/i.test(s.ticker) || /total points|over\/under/i.test(s.title ?? ""));
  const propS = league === "NFL" && players
    ? series.filter((s) => !isGame.test(s.ticker) && !spreadS.includes(s) && !totalS.includes(s) && PROP_STATS.some(([re]) => re.test(`${s.ticker} ${s.title ?? ""}`)))
    : [];

  const events = async (ticker: string) => ((await getJson<J>(`${KALSHI}/events`, { series_ticker: ticker, status: "open", with_nested_markets: "true", limit: 200 }))?.events ?? []) as J[];

  // ---- alt spreads & totals ----
  let rungs = 0, unread = "";
  for (const s of [...spreadS, ...totalS]) {
    const isSpread = spreadS.includes(s);
    for (const ev of await events(s.ticker)) {
      const c = gameFor(cards, `${ev.title ?? ""} ${ev.sub_title ?? ""}`);
      if (!c) continue;
      const pred = c.prediction;
      const list = out.ladders.get(c.matchup.id) ?? [];
      for (const m of (ev.markets ?? []) as J[]) {
        const text = [m.yes_sub_title, m.title, m.subtitle].filter(Boolean).join(" | ");
        const line = typeof m.floor_strike === "number" ? m.floor_strike : num(text.match(/(?:by|over|above|more than)\s+(?:over\s+)?(\d+(?:\.\d+)?)/i)?.[1] ?? text);
        if (line === undefined) { unread ||= text; continue; }
        const yes = ask(m, "yes"), no = ask(m, "no");
        // Price each rung from the sportsbooks' main line (the consensus), stretched to this line with the sport's
        // usual spread of results (real NFL results for football). No sportsbook line for the game -> no rung.
        const P = paramsFor(league);
        if (isSpread) {
          const teamText = (text.match(/^(.+?)\s+(?:wins?|win)\s+by/i)?.[1] ?? m.yes_sub_title ?? "").split("|")[0];
          const side = sideOf(c, teamText);
          if (!side) { unread ||= text; continue; }
          const mm = c.marketLine?.margin;
          if (mm === undefined) continue;
          // "side wins by over L"  ==  side -L ; the No side is the other team +L
          const pModel = side === "home" ? coverProb(pred, league, -line) : 1 - coverProb(pred, league, line);
          // NFL: real results vs. the line (key numbers 3 and 7); other sports: the usual bell curve
          const hist = league === "NFL" && history ? (side === "home" ? history.pMarginOver(mm, line) : history.pMarginOver(-mm, line)) : null;
          const pMkt = hist ?? (side === "home" ? normCdf((mm - line) / P.marginSd) : normCdf((-line - mm) / P.marginSd));
          const p = blend(pModel, pMkt);
          addRung(list, c, "alt_spread", side, -line, yes, p, "Kalshi", pMkt, pModel);
          addRung(list, c, "alt_spread", side === "home" ? "away" : "home", line, no, 1 - p, "Kalshi", 1 - pMkt, 1 - pModel);
        } else {
          const mt = c.marketLine?.total;
          if (mt === undefined) continue;
          const pModel = overProb(pred, league, line);
          const pMkt = (league === "NFL" && history ? history.pTotalOver(mt, line) : null) ?? 1 - normCdf((line - mt) / P.totalSd);
          const p = blend(pModel, pMkt);
          addRung(list, c, "alt_total", "over", line, yes, p, "Kalshi", pMkt, pModel);
          addRung(list, c, "alt_total", "under", line, no, 1 - p, "Kalshi", 1 - pMkt, 1 - pModel);
        }
        rungs++;
      }
      out.ladders.set(c.matchup.id, list);
    }
  }
  if (spreadS.length || totalS.length) out.diag.push({ name: `Kalshi alt lines ${league}`, ok: rungs > 0, detail: `${rungs} rungs priced${unread ? `; couldn't read e.g. "${unread.slice(0, 60)}"` : ""}` });

  // ---- player props (NFL, graded against our own projection) ----
  const fairYes = new Map<string, { yes?: number; no?: number; side: "over" | "under" }>();
  let propRungs = 0, noProj = 0; unread = "";
  for (const s of propS) {
    const [, stat, statLabel] = PROP_STATS.find(([re]) => re.test(`${s.ticker} ${s.title ?? ""}`))!;
    for (const ev of await events(s.ticker)) {
      for (const m of (ev.markets ?? []) as J[]) {
        const text = [m.yes_sub_title, m.title, m.subtitle].filter(Boolean).join(" | ");
        const player = text.match(/^(?:Will\s+)?([A-Z][A-Za-z.'\- ]+?)(?:\s*[:(]|\s+[-–]\s|\s+(?:record|have|get|score|throw|rush|catch|to|\d))/)?.[1]?.trim();
        const thr = typeof m.floor_strike === "number" ? m.floor_strike : num(text.match(/(\d+(?:\.\d+)?)\s*\+/)?.[1]) ?? (stat === "anytime_td" ? 1 : undefined);
        if (!player || thr === undefined || player.split(" ").length < 2) { unread ||= text; continue; }
        const team = players!.teamOf(player);
        const c = gameFor(cards, `${ev.title ?? ""} ${ev.sub_title ?? ""}`) ?? cards.find((x) => team && [x.matchup.home.abbreviation, x.matchup.away.abbreviation].map(toNflverseAbbr).includes(team));
        if (!c || !team) { noProj++; continue; }
        const isHome = toNflverseAbbr(c.matchup.home.abbreviation) === team;
        const opp = toNflverseAbbr(isHome ? c.matchup.away.abbreviation : c.matchup.home.abbreviation);
        const teamPts = isHome ? c.prediction.projectedScore.home : c.prediction.projectedScore.away;
        const ratings = isHome ? c.factors.home.ratings : c.factors.away.ratings;
        const usual = 22 + (ratings.offense ?? 0);
        const script = usual > 0 ? 1 + 0.25 * (teamPts / usual - 1) : 1;
        const teamOut = outByTeam.get(`${c.matchup.id}:${isHome ? "home" : "away"}`) ?? new Set<string>();
        if (teamOut.has(normName(player))) continue;   // he's out or doubtful himself
        const proj = players!.project(player, stat, opp, script, 0.06, players!.usageBoost(player, team, teamOut, stat));
        if (!proj) { noProj++; continue; }
        // "80+" means 80 or more. Kalshi may store it as 80 or as 79.5 ("above 79.5"); both become over 79.5 / shown "80+".
        const line = Number.isInteger(thr) ? thr - 0.5 : thr;
        const shownThr = Number.isInteger(thr) ? thr : Math.ceil(thr);
        for (const side of ["over", "under"] as const) {
          const a = ask(m, side === "over" ? "yes" : "no");
          if (!a) continue;
          const p = priceProp({
            id: `k:${c.matchup.id}:${stat}:${player}:${thr}:${side}`.replace(/\s+/g, "_"), matchupId: c.matchup.id,
            playerId: player.toLowerCase().replace(/\W+/g, "-"), playerName: player, team: isHome ? c.matchup.home.name : c.matchup.away.name, position: proj.pos,
            stat: stat === "passing_tds" ? "anytime_td" : (stat as PlayerProp["stat"]), line, isAlt: true, side,
            quote: { bookmaker: { key: "kalshi", name: "Kalshi" }, americanOdds: withFee(a), updatedAt: new Date().toISOString() },
            projection: proj, confidence: proj.games >= 3 ? "high" : proj.games >= 1 ? "medium" : "low", matchupNote: proj.note,
          });
          p.statLabel = stat === "anytime_td" ? (shownThr <= 1 ? "Anytime TD" : `${shownThr}+ TDs`) : `${shownThr}+ ${statLabel}`;
          fairYes.set(p.id, { yes: ask(m, "yes"), no: ask(m, "no"), side });
          p.source = "kalshi";
          p.ticker = m.ticker;
          out.props.push(p);
        }
        delete proj.quantiles;   // used for pricing both sides; not needed in the saved data
        propRungs++;
      }
    }
  }
  const cal = calibrateProps(out.props, fairYes);
  for (const msg of cal) out.diag.push({ name: "Prop calibration", ok: true, detail: msg });
  // props are noisier than game lines: anything 8+ points off the market is flagged and never recommended
  for (const p of out.props) p.flags = p.edge > PROP_GAP ? ["large_gap"] : undefined;
  if (propS.length) out.diag.push({ name: "Kalshi player props", ok: propRungs > 0, detail: `${propRungs} rungs priced from our projections${noProj ? `, ${noProj} without a projection` : ""}${unread ? `; couldn't read e.g. "${unread.slice(0, 60)}"` : ""}` });
  return out;
}

/** How far the model may move the sportsbook-based chance on an alt rung: the engine-wide setting (0 = market only). */
export const ALT_MODEL_WEIGHT = MODEL_WEIGHT;
const blend = (pModel: number, pMarket: number) => pMarket + ALT_MODEL_WEIGHT * (pModel - pMarket);

function addRung(list: ValueBet[], c: MatchupCardData, market: "alt_spread" | "alt_total", side: "home" | "away" | "over" | "under", line: number, price: number | undefined, p: number, book: string, marketProb?: number, modelOnlyProb?: number) {
  if (!price || p <= 0.03 || p >= 0.97) return;
  const american = withFee(price);
  const label = market === "alt_total" ? `${side === "over" ? "Over" : "Under"} (alt)` : `${c.matchup[side as "home" | "away"].shortName} alt spread`;
  let ladder = list.find((b) => b.label === label);
  if (!ladder) {
    ladder = {
      id: `${c.matchup.id}:${market}:${side}`, matchupId: c.matchup.id, market, side, label, bestQuote: { bookmaker: { key: "kalshi", name: book }, americanOdds: american, updatedAt: new Date().toISOString() },
      modelProb: p, impliedProb: impliedProb(american), edge: p - impliedProb(american), expectedValue: expectedValue(p, american), kellyFraction: kellyFraction(p, american),
      confidence: c.prediction.confidenceTier, rationale: "Kalshi ladder, each rung priced against the game model.", altLines: [],
    };
    list.push(ladder);
  }
  const rung: AltLine = { line, americanOdds: american, bookmaker: book, modelProb: p, edge: p - impliedProb(american), marketProb, modelOnlyProb };
  ladder.altLines = [...(ladder.altLines ?? []).filter((r) => r.line !== line), rung].sort((a, b) => a.line - b.line);
}

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * If the model's "over" chances run above Kalshi's across a whole stat on today's slate (a wall of plus-money Overs),
 * that's a calibration problem, not 30 separate edges. Only rungs near each player's projection are used to judge
 * the lean (far-off rungs behave differently and would hide it). Removes 80% of the lean per stat (in log-odds),
 * keeping each player's difference from the rest. Needs 6+ such rungs of a stat.
 */
function calibrateProps(props: PlayerProp[], fair: Map<string, { yes?: number; no?: number; side: "over" | "under" }>): string[] {
  const msgs: string[] = [];
  const byStat = new Map<string, PlayerProp[]>();
  for (const p of props) if (p.side === "over") byStat.set(p.stat, [...(byStat.get(p.stat) ?? []), p]);
  for (const [stat, overs] of byStat) {
    const gaps: number[] = [];
    for (const p of overs) {
      const f = fair.get(p.id);
      if (!f?.yes || !f.no) continue;
      const sd = p.projection.stdDev ?? Math.sqrt(Math.max(p.projection.mean, 0.5));
      if (Math.abs(p.line - p.projection.mean) > 1.25 * sd) continue;   // judge the lean where picks actually come from
      const mkt = f.yes / (f.yes + f.no);                    // Kalshi's own chance, with its spread removed
      if (mkt < 0.04 || mkt > 0.96) continue;
      gaps.push(logit(Math.min(0.96, Math.max(0.04, p.modelProb))) - logit(mkt));
    }
    if (gaps.length < 6) continue;
    const bias = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (Math.abs(bias) < 0.1) continue;
    const shift = 0.8 * bias;
    for (const p of props.filter((x) => x.stat === stat)) {
      const over = p.side === "over" ? p.modelProb : 1 - p.modelProb;
      const adj = sigmoid(logit(Math.min(0.96, Math.max(0.04, over))) - shift);
      p.modelProb = Math.min(0.96, Math.max(0.04, p.side === "over" ? adj : 1 - adj));
      p.edge = p.modelProb - p.impliedProb;
    }
    const label = stat.replace(/_/g, " ");
    msgs.push(`${label}: the model ran ${bias > 0 ? "high" : "low"} on Overs across ${gaps.length} Kalshi rungs, so that lean was mostly removed`);
  }
  return msgs;
}
