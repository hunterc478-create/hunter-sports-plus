/**
 * Sports Plus picks (v2): straight bets where one book's price beats the market consensus.
 *
 *   in:  public/data/live.json        (games, every book's price, the books' no-vig consensus)
 *        public/data/tennis-odds.json (tennis moneylines + total games, every book)
 *        public/data/picks.json       (previous log; pulled from the live site when missing)
 *   out: public/data/picks.json       { updatedAt, picks: Pick[] }
 *
 * Rules (why: the old model lost 46 units on alt lines and beat the closing line only 27% of the time):
 *   - moneyline / spread / total only, priced by 4+ books (3+ for tennis), odds between -250 and +300
 *   - fair chance = the books' consensus with the juice removed; a pick needs 2.5%+ expected value at the best price
 *   - a price more than 6 points better than the consensus is treated as stale and skipped
 *   - one pick per game, logged once (price locked) inside 18 hours of the start, capped per sport per day
 *   - every run until the start records the closing consensus, so we can see if the picks beat the close (CLV)
 *   - graded from final scores (ESPN for tennis total games), 1 unit flat
 */
import fs from "node:fs";
import path from "node:path";

type Side = "home" | "away" | "draw" | "over" | "under";
type Market = "moneyline" | "spread" | "total";
interface Team { name: string; short: string; abbr?: string; logo?: string }
export interface Pick {
  id: string; matchupId: string; league: string; sport: string;
  market: Market; side: Side; line?: number; label: string;
  home: Team; away: Team; start: string;
  book: string; odds: number; fair: number; ev: number; books: number;
  myBooks?: { name: string; odds: number }[];
  loggedAt: string;
  closeFair?: number; closeOdds?: number;
  why?: string[];
  result?: "win" | "loss" | "push" | "void"; units?: number; score?: string; settledAt?: string;
}

const DATA = path.join("public", "data");
const SITE = (process.env.SITE_URL || "https://hunterc478-create.github.io/hunter-sports-plus").replace(/\/$/, "");
const SPORT: Record<string, string> = {
  NBA: "NBA", NHL: "NHL", NCAAB: "College Hoops", WNBA: "WNBA", MLB: "MLB",
  EPL: "Soccer", LALIGA: "Soccer", SERIEA: "Soccer", BUNDESLIGA: "Soccer", LIGUE1: "Soccer", MLS: "Soccer", UCL: "Soccer",
  ATP: "Tennis", WTA: "Tennis",
};
const CAP: Record<string, number> = { NBA: 5, NHL: 5, "College Hoops": 6, Soccer: 6, Tennis: 6, "Tennis totals": 4, WNBA: 3, MLB: 5 };
const capKey = (sport: string, market: string) => (sport === "Tennis" && market === "total" ? "Tennis totals" : sport);
const MIN_EV = 0.025, MAX_GAP = 0.06, LOG_WINDOW_H = 18;
const OK_BOOK = /fanduel|draft ?kings|betmgm|betrivers|fanatics|caesars|hard rock|bet365|espn ?bet|kalshi|novig|fliff/i;
const MY_BOOK = /fanduel|kalshi|novig|fliff/i;
const TZ = "America/Chicago";

const dec = (o: number) => (o > 0 ? 1 + o / 100 : 1 + 100 / -o);
const imp = (o: number) => 1 / dec(o);
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const r3 = (x: number) => Math.round(x * 1000) / 1000;

async function getJson<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url, { headers: { "user-agent": "sports-plus" } }); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}
function readJson<T>(file: string): T | null { try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; } }

/* ---------------- candidates from the board ---------------- */
type J = Record<string, any>;
interface Cand { why?: string[]; tourney?: string; matchupId: string; league: string; market: Market; side: Side; line?: number; label: string; home: Team; away: Team; start: string; book: string; odds: number; fair: number; ev: number; books: number; myBooks: { name: string; odds: number }[] }

const team = (c: J): Team => ({ name: c.name, short: c.shortName || c.name, abbr: c.abbreviation, logo: c.logoUrl });

function bestPrice(books: { name: string; odds: number }[], fair: number) {
  let best: { name: string; odds: number; ev: number } | null = null;
  for (const b of books) {
    if (!OK_BOOK.test(b.name) || !Number.isFinite(b.odds)) continue;
    if (fair - imp(b.odds) > MAX_GAP) continue;                  // too good to be true: stale or a typo
    const ev = fair * dec(b.odds) - 1;
    if (!best || ev > best.ev) best = { name: b.name.replace("Draft Kings", "DraftKings"), odds: b.odds, ev };
  }
  return best;
}

function boardCands(bundle: J, now: number): Cand[] {
  const out: Cand[] = [];
  for (const c of bundle?.byDay?.all?.matchups ?? []) {
    const m = c.matchup;
    if (!SPORT[m.league] || m.status !== "scheduled" || new Date(m.startTime).getTime() <= now) continue;
    for (const v of [c.recommended, ...(c.otherBets ?? [])]) {
      if (!v || !["moneyline", "spread", "total"].includes(v.market)) continue;
      const need = SPORT[m.league] === "Tennis" ? 3 : 4;
      if (!v.marketProb || (v.marketBooks ?? 0) < need || !v.books?.length) continue;
      const b = bestPrice(v.books, v.marketProb);
      if (!b || b.odds < -250 || b.odds > 300) continue;
      out.push({
        matchupId: m.id, league: m.league, market: v.market, side: v.side, line: v.line, label: v.label,
        home: team(m.home), away: team(m.away), start: m.startTime, book: b.name, odds: b.odds, fair: v.marketProb, ev: b.ev, books: v.marketBooks,
        myBooks: v.books.filter((x: J) => MY_BOOK.test(x.name)).map((x: J) => ({ name: x.name, odds: x.odds })),
      });
    }
  }
  return out;
}

/* ---------------- tennis total games (from the tennis odds cache) ---------------- */
const pn = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim();
const lastName = (s: string) => pn(s).split(" ").pop() || "";
const samePlayer = (a: string, b: string) => pn(a) === pn(b) || (lastName(a) === lastName(b) && pn(a)[0] === pn(b)[0]);

function noVig(a: number, b: number) { const x = imp(a), y = imp(b); return x / (x + y); }
function median(xs: number[]) { const s = [...xs].sort((p, q) => p - q), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; }

function tennisTotalCands(bundle: J, cache: J | null, now: number): Cand[] {
  const out: Cand[] = [];
  const cards = (bundle?.byDay?.all?.matchups ?? []).filter((c: J) => SPORT[c.matchup.league] === "Tennis" && c.matchup.status === "scheduled");
  for (const ev of cache?.events ?? []) {
    const tq = (ev.quotes ?? []).filter((q: J) => (q.side === "over" || q.side === "under") && q.point != null);
    if (!tq.length) continue;
    const card = cards.find((c: J) => (samePlayer(c.matchup.home.name, ev.home) && samePlayer(c.matchup.away.name, ev.away)) || (samePlayer(c.matchup.home.name, ev.away) && samePlayer(c.matchup.away.name, ev.home)));
    if (!card || new Date(card.matchup.startTime).getTime() <= now) continue;
    // main line = the point most books post
    const byPoint = new Map<number, J[]>();
    for (const q of tq) byPoint.set(q.point, [...(byPoint.get(q.point) ?? []), q]);
    const [point, qs] = [...byPoint.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const perBook = new Map<string, { over?: number; under?: number }>();
    for (const q of qs) { const b = perBook.get(q.book) ?? {}; b[q.side as "over" | "under"] = q.price; perBook.set(q.book, b); }
    const two = [...perBook.values()].filter((b) => b.over != null && b.under != null);
    if (two.length < 3) continue;
    const fairOver = median(two.map((b) => noVig(b.over!, b.under!)));
    for (const side of ["over", "under"] as const) {
      const fair = side === "over" ? fairOver : 1 - fairOver;
      const books = [...perBook.entries()].filter(([, b]) => b[side] != null).map(([name, b]) => ({ name, odds: b[side]! }));
      const b = bestPrice(books, fair);
      if (!b || b.odds < -250 || b.odds > 300) continue;
      const m = card.matchup;
      out.push({
        matchupId: m.id, league: m.league, market: "total", side, line: point, label: `${side === "over" ? "Over" : "Under"} ${point} games`,
        home: team(m.home), away: team(m.away), start: m.startTime, book: b.name, odds: b.odds, fair, ev: b.ev, books: two.length,
        myBooks: books.filter((x) => MY_BOOK.test(x.name)),
      });
    }
  }
  return out;
}

/* ---------------- the "why": ESPN's game preview, put into words ---------------- */
const ESPN_PATH: Record<string, string> = {
  NBA: "basketball/nba", WNBA: "basketball/wnba", NCAAB: "basketball/mens-college-basketball", NHL: "hockey/nhl", MLB: "baseball/mlb",
  EPL: "soccer/eng.1", LALIGA: "soccer/esp.1", SERIEA: "soccer/ita.1", BUNDESLIGA: "soccer/ger.1", LIGUE1: "soccer/fra.1", MLS: "soccer/usa.1", UCL: "soccer/uefa.champions",
};
const UNIT: Record<string, string> = { NBA: "points", WNBA: "points", NCAAB: "points", NHL: "goals", MLB: "runs" };
const nm = (x?: string) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
function sameTeam(espn: J, t: Team) {
  const ours = [t.name, t.short, t.abbr].filter(Boolean).map(nm);
  const theirs = [espn.displayName, espn.shortDisplayName, espn.name, espn.location, espn.abbreviation, espn.nickname].filter(Boolean).map(nm);
  if (ours.some((o) => theirs.includes(o))) return true;
  const full = nm(t.name), d = nm(espn.displayName);
  return !!full && !!d && (full.includes(d) || d.includes(full));
}
const boards: Record<string, Promise<J | null>> = {};
async function espnEvent(p: Pick): Promise<string | null> {
  const path = ESPN_PATH[p.league]; if (!path) return null;
  const day = new Date(p.start).toLocaleDateString("en-CA", { timeZone: "America/New_York" }).replace(/-/g, "");
  const extra = p.league === "NCAAB" ? "&groups=50&limit=400" : "";
  const b = await (boards[path + day] ??= getJson<J>(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}${extra}`));
  for (const ev of b?.events ?? []) {
    const cs = ev.competitions?.[0]?.competitors ?? [];
    const h = cs.find((c: J) => c.homeAway === "home")?.team, a = cs.find((c: J) => c.homeAway === "away")?.team;
    if (h && a && ((sameTeam(h, p.home) && sameTeam(a, p.away)) || (sameTeam(h, p.away) && sameTeam(a, p.home)))) return String(ev.id);
  }
  return null;
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x: number) => (Math.round(x * 10) / 10).toString();

async function buildWhy(p: Pick): Promise<string[]> {
  const out: string[] = [];
  const id = await espnEvent(p);
  const sum = id ? await getJson<J>(`https://site.api.espn.com/apis/site/v2/sports/${ESPN_PATH[p.league]}/summary?event=${id}`) : null;
  const unit = UNIT[p.league] || "goals";
  const comp = sum?.header?.competitions?.[0];
  const cs: J[] = comp?.competitors ?? [];
  const side = (ha: "home" | "away") => cs.find((c) => c.homeAway === ha);
  const ours = p.side === "home" || p.side === "away" ? p.side : null;
  const theirs = ours === "home" ? "away" : ours === "away" ? "home" : null;
  const tname = (ha: "home" | "away") => (ha === "home" ? p.home.short : p.away.short);

  // last five: record and scoring
  const l5 = (ha: "home" | "away") => {
    const tid = String(side(ha)?.team?.id ?? "");
    const blk = (sum?.lastFiveGames ?? []).find((x: J) => String(x.team?.id) === tid);
    const evs: J[] = blk?.events ?? [];
    if (!evs.length) return null;
    const pf: number[] = [], pa: number[] = [];
    let w = 0, l = 0, d = 0;
    for (const e of evs) {
      const home = String(e.homeTeamId) === tid;
      const a = Number(home ? e.homeTeamScore : e.awayTeamScore), b = Number(home ? e.awayTeamScore : e.homeTeamScore);
      if (Number.isFinite(a) && Number.isFinite(b)) { pf.push(a); pa.push(b); }
      if (/^w/i.test(e.gameResult || "")) w++; else if (/^l/i.test(e.gameResult || "")) l++; else if (/^[dt]/i.test(e.gameResult || "")) d++;
    }
    return { w, l, d, n: evs.length, pf: avg(pf), pa: avg(pa), txt: d ? `${w}W-${d}D-${l}L` : `${w}-${l}` };
  };
  const rec = (ha: "home" | "away", type: RegExp) => (side(ha)?.record ?? []).find((r: J) => type.test(r.type || r.name || ""))?.summary;
  const outs = (ha: "home" | "away") => {
    const tid = String(side(ha)?.team?.id ?? "");
    const blk = (sum?.injuries ?? []).find((x: J) => String(x.team?.id) === tid);
    return (blk?.injuries ?? []).filter((i: J) => /^out/i.test(i.status || "")).map((i: J) => i.athlete?.displayName).filter(Boolean).slice(0, 3) as string[];
  };
  const proj = (ha: "home" | "away") => Number(sum?.predictor?.[ha === "home" ? "homeTeam" : "awayTeam"]?.gameProjection);

  if (ours && theirs) {
    const me = l5(ours), opp = l5(theirs);
    if (me && Number.isFinite(me.pf)) out.push(`${tname(ours)} ${me.w >= 4 ? "are rolling:" : "are"} ${me.txt} in their last ${me.n}, scoring ${f1(me.pf)} and allowing ${f1(me.pa)} ${unit} a game`);
    if (opp && Number.isFinite(opp.pa)) out.push(`${tname(theirs)} ${opp.l >= 3 || opp.w <= 1 ? "are struggling:" : "are"} ${opp.txt} in their last ${opp.n}, giving up ${f1(opp.pa)} ${unit} a game`);
    const venueMe = rec(ours, ours === "home" ? /^home/i : /^(road|away)/i), venueOpp = rec(theirs, theirs === "home" ? /^home/i : /^(road|away)/i);
    if (venueMe || venueOpp) out.push([venueMe && `${tname(ours)} are ${venueMe} ${ours === "home" ? "at home" : "on the road"}`, venueOpp && `${tname(theirs)} are ${venueOpp} ${theirs === "home" ? "at home" : "on the road"}`].filter(Boolean).join("; "));
    const o = outs(theirs), m = outs(ours);
    if (o.length) out.push(`${tname(theirs)} are missing ${o.join(", ")}`);
    if (m.length) out.push(`Heads up: ${tname(ours)} are without ${m.join(", ")}`);
    const pr = proj(ours);
    if (Number.isFinite(pr)) out.push(pr / 100 >= p.fair - 0.02 ? `ESPN's matchup model also likes ${tname(ours)} (${Math.round(pr)}% to win)` : `ESPN's matchup model is lower on ${tname(ours)} (${Math.round(pr)}% to win), so this one is mostly about the price`);
  } else if (p.market === "total" && p.line != null && p.sport !== "Tennis") {
    const h = l5("home"), a = l5("away");
    if (h && a && Number.isFinite(h.pf) && Number.isFinite(a.pf)) {
      const ht = h.pf + h.pa, at = a.pf + a.pa, both = (ht + at) / 2;
      out.push(`${p.home.short}'s last ${h.n} games averaged ${f1(ht)} total ${unit}; ${p.away.short}'s averaged ${f1(at)}`);
      out.push(both > p.line ? `Both teams' recent games run ${f1(both - p.line)} ${unit} over this ${p.line} line${p.side === "under" ? ", so the under is a price play against the trend" : ""}` : `Both teams' recent games run ${f1(p.line - both)} ${unit} under this ${p.line} line${p.side === "over" ? ", so the over is a price play against the trend" : ""}`);
    }
    const o = [...outs("home"), ...outs("away")];
    if (o.length) out.push(`Out: ${o.slice(0, 4).join(", ")}`);
  }
  // the price, always
  const others = (p.myBooks ?? []).filter((b) => b.name !== p.book);
  out.push(`${p.book} has ${fmtOdds(p.odds)}, while the market's fair price is about ${fmtOdds(fairOdds(p.fair))} (${Math.round(p.fair * 100)}% to hit)${others.length ? ` · ${others.map((b) => `${b.name} ${fmtOdds(b.odds)}`).join(", ")}` : ""}`);
  return out.slice(0, 5);
}
const fmtOdds = (o: number) => (o > 0 ? "+" + Math.round(o) : String(Math.round(o)));
const fairOdds = (q: number) => (q >= 0.5 ? -100 * q / (1 - q) : 100 * (1 - q) / q);

/* ---------------- grading ---------------- */
function gradeScore(p: Pick, home: number, away: number): "win" | "loss" | "push" {
  const line = p.line ?? 0;
  let d: number;
  if (p.market === "moneyline") d = p.side === "home" ? home - away : p.side === "away" ? away - home : home === away ? 1 : -1;
  else if (p.market === "spread") d = (p.side === "home" ? home - away : away - home) + line;
  else d = p.side === "over" ? home + away - line : line - (home + away);
  return d > 0 ? "win" : d < 0 ? "loss" : "push";
}

const TOUR: Record<string, string> = { ATP: "atp", WTA: "wta" };
const tennisBoards: Record<string, Promise<J | null>> = {};
async function tennisGames(p: Pick): Promise<number | null> {
  const tour = TOUR[p.league];
  if (!tour) return null;
  const board = await (tennisBoards[tour] ??= getJson<J>(`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard`));
  const id = p.matchupId.split("-").pop();
  for (const ev of board?.events ?? []) for (const g of ev.groupings ?? []) for (const c of g.competitions ?? []) {
    if (String(c.id) !== id || c.status?.type?.state !== "post") continue;
    return (c.competitors ?? []).reduce((n: number, x: J) => n + (x.linescores ?? []).reduce((t: number, l: J) => t + (Number(l.value) || 0), 0), 0);
  }
  return null;
}

/* ---------------- main ---------------- */
async function main() {
  const now = Date.now();
  const bundle = readJson<J>(path.join(DATA, "live.json")) ?? readJson<J>(path.join("data", "live.json"));
  if (!bundle) { console.log("picks: no board, nothing to do"); return; }
  const tennisCache = readJson<J>(path.join(DATA, "tennis-odds.json"));
  // Kalshi tennis matches priced by the rating model (scripts/tennis.mjs)
  const kt = readJson<{ cands: Cand[]; results: Record<string, string>; totals?: Record<string, string> }>(path.join(DATA, "tennis-cands.json"));
  const tennisK = (kt?.cands ?? []).filter((c) => new Date(c.start).getTime() > now);
  const results = readJson<Record<string, { home: number; away: number }>>(path.join(DATA, "results.json")) ?? {};
  let prev = readJson<{ picks: Pick[] }>(path.join(DATA, "picks.json"));
  if (!prev) prev = await getJson<{ picks: Pick[] }>(`${SITE}/data/picks.json`);
  // the first tennis-model run (before the tour fix) logged picks from bad ratings: drop them
  const picks: Pick[] = (prev?.picks ?? []).filter((p) => !(p.matchupId.startsWith("KX") && p.loggedAt < "2026-11-09T06:08"));
  const byId = new Map(picks.map((p) => [p.id, p]));

  // 1) candidates, best first
  const cands = [...boardCands(bundle, now), ...tennisTotalCands(bundle, tennisCache, now), ...tennisK].filter((c) => c.ev >= (c.book === "Kalshi" && SPORT[c.league] === "Tennis" ? 0.03 : MIN_EV)).sort((a, b) => b.ev - a.ev);

  // 2) closing line: refresh every still-pending pick from the current board until it starts
  const all = [...boardCands(bundle, now), ...tennisTotalCands(bundle, tennisCache, now), ...tennisK];
  for (const p of picks) {
    if (p.result || new Date(p.start).getTime() <= now) continue;
    const c = all.find((x) => x.matchupId === p.matchupId && x.market === p.market && x.side === p.side && (x.line ?? null) === (p.line ?? null));
    if (c) { p.closeFair = r3(c.fair); p.closeOdds = c.odds; }
  }

  // 3) log new picks: one per game, inside the window, capped per sport per day
  const perDay = new Map<string, number>();
  for (const p of picks) { const k = capKey(p.sport, p.market) + "|" + dayOf(p.start); perDay.set(k, (perDay.get(k) ?? 0) + 1); }
  const games = new Set(picks.map((p) => p.matchupId));
  let added = 0;
  for (const c of cands) {
    const sport = SPORT[c.league];
    const hours = (new Date(c.start).getTime() - now) / 3600_000;
    if (hours > LOG_WINDOW_H || games.has(c.matchupId)) continue;
    const k = capKey(sport, c.market) + "|" + dayOf(c.start);
    if ((perDay.get(k) ?? 0) >= (CAP[capKey(sport, c.market)] ?? 4)) continue;
    const id = `${c.matchupId}:${c.market}:${c.side}:${c.line ?? ""}`;
    if (byId.has(id)) continue;
    const p: Pick = { id, sport, ...c, fair: r3(c.fair), ev: r3(c.ev), loggedAt: new Date(now).toISOString(), closeFair: r3(c.fair), closeOdds: c.odds };
    picks.push(p); byId.set(id, p); games.add(c.matchupId); perDay.set(k, (perDay.get(k) ?? 0) + 1); added++;
  }

  // 3b) the "why" for open picks (refreshed each run so injuries stay current)
  let whys = 0;
  for (const p of picks) {
    if (p.result || new Date(p.start).getTime() <= now) continue;
    if (p.sport === "Tennis" && p.matchupId.startsWith("KX")) { const c = tennisK.find((x) => x.matchupId === p.matchupId && x.side === p.side); if (c?.why) p.why = c.why; continue; }
    try { const w = await buildWhy(p); if (w.length) { p.why = w; whys++; } } catch {}
  }
  const sample = picks.find((p) => !p.result && p.why && p.why.length > 1);
  if (sample) console.log(`picks: why sample (${sample.league} ${sample.label}):\n  - ` + sample.why!.join("\n  - "));

  // 4) grade
  let graded = 0;
  for (const p of picks) {
    if (p.result) continue;
    const started = new Date(p.start).getTime();
    if (p.sport === "Tennis" && p.matchupId.startsWith("KX")) {
      if (p.market === "total") {
        const r = kt?.totals?.[`${p.matchupId}|${p.line}`];
        if (r === "yes" || r === "no") { const over = r === "yes"; p.result = (p.side === "over") === over ? "win" : "loss"; p.score = `${over ? "Over" : "Under"} ${p.line} games`; }
      } else {
        const w = kt?.results?.[p.matchupId];
        if (w) { const won = nm(w) === nm(p.side === "home" ? p.home.name : p.away.name); p.result = won ? "win" : "loss"; p.score = `${w} won`; }
      }
    } else if (p.sport === "Tennis" && p.market === "total") {
      const g = await tennisGames(p);
      if (g != null) { p.result = gradeScore(p, g, 0); p.score = `${g} games`; }
    } else {
      const r = results[p.matchupId];
      if (r) { p.result = gradeScore(p, r.home, r.away); p.score = `${p.away.short} ${r.away} – ${p.home.short} ${r.home}`; }
    }
    if (!p.result && now - started > 4 * 86400_000) p.result = "void";      // never got a final score (postponed / walkover)
    if (p.result) {
      p.units = p.result === "win" ? r3(dec(p.odds) - 1) : p.result === "loss" ? -1 : 0;
      p.settledAt = new Date(now).toISOString(); graded++;
    }
  }

  picks.sort((a, b) => b.start.localeCompare(a.start));
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, "picks.json"), JSON.stringify({ updatedAt: new Date(now).toISOString(), startedAt: picks.length ? picks[picks.length - 1].loggedAt : null, picks }));
  const open = picks.filter((p) => !p.result).length;
  console.log(`picks: why written for ${whys} open picks`);
  console.log(`picks: ${cands.length} candidates with ${MIN_EV * 100}%+ value · ${added} new · ${graded} graded · ${open} open · ${picks.length} total`);
}

main().catch((e) => { console.error("picks failed:", e); process.exitCode = 0; });
