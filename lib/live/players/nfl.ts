/**
 * NFL player projections from nflverse weekly stats (free, GitHub-hosted).
 *   mean = recent form (this season blended with last season) x opponent factor x game-script factor
 * Opponent factor: what that defense allows to the position for this stat vs league average (shrunk by games played).
 */
import { execFile } from "node:child_process";
import zlib from "node:zlib";
import type { PlayerProjection, WhyPart } from "@/types/sports";

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** A team's pass/rush offense and defense this season, per game and ranked 1-32 (1 = best: most gained, fewest allowed). */
export interface TeamUnits {
  games: number;
  passFor: number; rushFor: number; passAllowed: number; rushAllowed: number;
  rank: { passFor: number; rushFor: number; passAllowed: number; rushAllowed: number };
}

export type NflStat = "passing_yards" | "rushing_yards" | "receiving_yards" | "receptions" | "anytime_td" | "passing_tds";
type Row = { name: string; pos: string; team: string; opp: string; week: number; season: number; v: Record<string, number> };

const COLS = ["passing_yards", "rushing_yards", "receiving_yards", "receptions", "passing_tds", "rushing_tds", "receiving_tds", "carries", "targets", "attempts"] as const;
const PRIOR_GAMES = 5;       // last season's average counts like 5 games of evidence (hot starts regress)
const OPP_PRIOR = 4;         // opponent factors need ~4 games before they count half

function download(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => execFile("curl", ["-sS", "-L", "--fail", "--max-time", "90", url], { encoding: "buffer", maxBuffer: 200 * 1024 * 1024 }, (e, out) => resolve(e ? null : out)));
}

function parse(buf: Buffer, season: number): Row[] {
  const lines = zlib.gunzipSync(buf).toString("utf8").split(/\r?\n/).filter(Boolean);
  const split = (l: string) => { const o: string[] = []; let c = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { o.push(c); c = ""; } else c += ch; } o.push(c); return o; };
  const h = split(lines[0]);
  const ix = (k: string) => h.indexOf(k);
  const iName = ix("player_display_name"), iPos = ix("position"), iTeam = ix("team"), iOpp = ix("opponent_team"), iWeek = ix("week"), iType = ix("season_type");
  if ([iName, iPos, iTeam, iOpp, iWeek].some((i) => i < 0)) return [];
  const colIx = COLS.map((c) => ix(c));
  const rows: Row[] = [];
  for (const l of lines.slice(1)) {
    const r = split(l);
    if (iType >= 0 && r[iType] !== "REG") continue;
    const v: Record<string, number> = {};
    COLS.forEach((c, k) => { v[c] = Number(r[colIx[k]]) || 0; });
    rows.push({ name: r[iName], pos: r[iPos], team: r[iTeam], opp: r[iOpp], week: Number(r[iWeek]), season, v });
  }
  return rows;
}

const statValue = (r: Row, s: NflStat) => (s === "anytime_td" ? r.v.rushing_tds + r.v.receiving_tds : r.v[s]);
const posGroup = (pos: string) => (pos === "QB" ? "QB" : pos === "RB" || pos === "FB" ? "RB" : pos === "WR" || pos === "TE" ? "REC" : "OTHER");
export const normName = (s: string) => norm(s);
export const toNflverseAbbr = (abbr?: string) => (abbr === "LAR" ? "LA" : abbr === "WSH" ? "WAS" : abbr ?? "");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();

export class NflPlayers {
  constructor(private cur: Row[], private prev: Row[]) {}

  static async load(season: number): Promise<NflPlayers | null> {
    const get = async (y: number) => {
      const b = await download(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${y}.csv.gz`);
      return b ? parse(b, y) : [];
    };
    const [cur, prev] = await Promise.all([get(season), get(season - 1)]);
    return cur.length || prev.length ? new NflPlayers(cur, prev) : null;
  }

  private ratioCache = new Map<string, number[]>();

  /**
   * How single games spread around a player's average, for one stat and position group, measured from real games:
   * every game divided by that player's season average (players with 4+ games and real volume). Returned as the
   * ratio at 100 evenly spaced percentiles. Yards come out lopsided (median well below 1), which is the point.
   */
  ratios(stat: NflStat, pos: string): number[] | null {
    if (stat !== "passing_yards" && stat !== "rushing_yards" && stat !== "receiving_yards") return null;
    const group = posGroup(pos);
    const key = `${stat}|${group}`;
    if (this.ratioCache.has(key)) return this.ratioCache.get(key)!;
    const minAvg: Partial<Record<NflStat, number>> = { passing_yards: 120, rushing_yards: 8, receiving_yards: 12 };
    const all: number[] = [];
    for (const rows of [this.prev, this.cur]) {
      const byPlayer = new Map<string, Row[]>();
      for (const r of rows) if (posGroup(r.pos) === group) byPlayer.set(r.name, [...(byPlayer.get(r.name) ?? []), r]);
      for (const games of byPlayer.values()) {
        if (games.length < 4) continue;
        const vals = games.map((g) => statValue(g, stat));
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        if (avg < (minAvg[stat] ?? 1)) continue;
        for (const v of vals) all.push(Math.max(0, v) / avg);
      }
    }
    if (all.length < 200) { this.ratioCache.set(key, null as unknown as number[]); return null; }
    all.sort((a, b) => a - b);
    const q = Array.from({ length: 100 }, (_, i) => all[Math.min(all.length - 1, Math.floor(((i + 0.5) / 100) * all.length))]);
    this.ratioCache.set(key, q);
    return q;
  }

  /** What the player actually did in his most recent game against either of these teams (for grading props). */
  /**
   * The player's stat in THIS game: both teams must match (his team and the opponent), and the week when known.
   * Matching on either team alone used to return his previous game when this week's stats weren't posted yet.
   */
  actual(player: string, stat: string, teams: string[], week?: number): number | null {
    const n = norm(player);
    const key: NflStat = (stat === "touchdowns" ? "anytime_td" : stat) as NflStat;
    const rows = this.cur.filter((r) => norm(r.name) === n && teams.includes(r.team) && teams.includes(r.opp) && (week === undefined || r.week === week))
      .sort((a, b) => b.week - a.week);
    return rows.length ? statValue(rows[0], key) : null;
  }

  /** Whether this game's player stats are posted yet (any player with both teams and the week). */
  gamePosted(teams: string[], week?: number): boolean {
    return this.cur.some((r) => teams.includes(r.team) && teams.includes(r.opp) && (week === undefined || r.week === week));
  }

  /** Players who get the ball for a team this season (3+ touches a game or a TD), for the TD derby. */
  /**
   * Teammate injuries -> redistributed usage. When teammates are out, 85% of their carries go to the other backs and
   * 60% of their targets go to the other pass catchers (the rest goes to depth players or the offense throws less),
   * each in proportion to their current share. If the
   * starting QB is out, pass catchers take a 10% haircut for the backup. Returns a multiplier and a plain note.
   */
  usageBoost(player: string, team: string, out: Set<string>, stat: NflStat): { factor: number; note: string } | null {
    if (!out.size || stat === "passing_yards" || stat === "passing_tds") return null;
    const latest = new Map<string, string>();
    for (const r of [...this.cur].sort((a, b) => a.week - b.week)) latest.set(r.name, r.team);
    const by = new Map<string, { pos: string; games: number; carries: number; targets: number; attempts: number }>();
    for (const r of this.cur) {
      if (latest.get(r.name) !== team) continue;
      const x = by.get(r.name) ?? { pos: r.pos, games: 0, carries: 0, targets: 0, attempts: 0 };
      x.games++; x.carries += r.v.carries; x.targets += r.v.targets; x.attempts += r.v.attempts;
      by.set(r.name, x);
    }
    const per = [...by.entries()].map(([name, x]) => ({ name, n: norm(name), pos: posGroup(x.pos), carries: x.carries / x.games, targets: x.targets / x.games, attempts: x.attempts / x.games }));
    const me = per.find((x) => x.n === norm(player));
    if (!me) return null;
    const missing = per.filter((x) => out.has(x.n) && x.n !== me.n);
    if (!missing.length) return null;
    const lostCarries = missing.filter((x) => x.pos === "RB").reduce((a, x) => a + x.carries, 0) * 0.85;
    const lostTargets = missing.filter((x) => x.pos !== "QB").reduce((a, x) => a + x.targets, 0) * 0.6;
    const rbPool = per.filter((x) => x.pos === "RB" && !out.has(x.n)).reduce((a, x) => a + x.carries, 0);
    const tgtPool = per.filter((x) => x.pos !== "QB" && !out.has(x.n)).reduce((a, x) => a + x.targets, 0);
    const addCarries = me.pos === "RB" && rbPool > 0 ? lostCarries * (me.carries / rbPool) : 0;
    const addTargets = me.pos !== "QB" && tgtPool > 0 ? lostTargets * (me.targets / tgtPool) : 0;
    const cb = me.carries > 0.5 ? (me.carries + addCarries) / me.carries : 1;
    const tb = me.targets > 0.5 ? (me.targets + addTargets) / me.targets : 1;
    const starter = [...per].sort((a, b) => b.attempts - a.attempts)[0];
    const qbOut = !!starter && starter.attempts > 10 && out.has(starter.n) && me.pos !== "QB";
    let factor = stat === "rushing_yards" ? cb
      : stat === "receiving_yards" || stat === "receptions" ? tb
      : (me.carries * cb + me.targets * tb) / Math.max(0.5, me.carries + me.targets);   // touchdowns follow total touches
    if (qbOut && stat !== "rushing_yards") factor *= 0.9;
    factor = Math.max(0.7, Math.min(1.6, factor));
    if (Math.abs(factor - 1) < 0.02) return null;
    const pctTxt = `${factor >= 1 ? "+" : ""}${Math.round((factor - 1) * 100)}%`;
    const usageOuts = missing.filter((x) => (stat === "rushing_yards" ? x.pos === "RB" : x.pos !== "QB")).map((x) => x.name);
    const gained = stat === "rushing_yards" ? addCarries : stat === "receiving_yards" || stat === "receptions" ? addTargets : addCarries + addTargets;
    const unit = stat === "rushing_yards" ? "carries" : stat === "receiving_yards" || stat === "receptions" ? "targets" : "touches";
    const parts: string[] = [];
    if (usageOuts.length && gained >= 0.1) parts.push(`With ${usageOuts.slice(0, 2).join(" and ")} out, he picks up about ${gained.toFixed(1)} more ${unit} a game`);
    if (qbOut && stat !== "rushing_yards") parts.push(`backup QB starting for ${starter.name}`);
    if (!parts.length) return null;
    const note = `${parts.join("; ").replace(/^b/, "B")} (${pctTxt} overall)`;
    return { factor, note };
  }

  candidates(team: string): { name: string; pos: string; touches: number }[] {
    const by = new Map<string, { pos: string; games: number; touches: number; tds: number }>();
    const latest = new Map<string, string>();
    for (const r of [...this.cur].sort((a, b) => a.week - b.week)) latest.set(r.name, r.team);
    for (const r of this.cur) {
      if (latest.get(r.name) !== team || posGroup(r.pos) === "OTHER") continue;
      const x = by.get(r.name) ?? { pos: r.pos, games: 0, touches: 0, tds: 0 };
      x.games++; x.touches += r.v.carries + r.v.targets; x.tds += r.v.rushing_tds + r.v.receiving_tds;
      by.set(r.name, x);
    }
    return [...by.entries()].map(([name, x]) => ({ name, pos: x.pos, touches: x.touches / x.games, tds: x.tds }))
      .filter((x) => x.touches >= 3 || x.tds > 0).map(({ name, pos, touches }) => ({ name, pos, touches }));
  }

  /** The player's current team (nflverse abbreviation), from their latest game. */
  teamOf(player: string): string | undefined {
    const n = norm(player);
    const rows = this.cur.filter((r) => norm(r.name) === n);
    return rows.sort((a, b) => b.week - a.week)[0]?.team;
  }

  private unitsCache: Map<string, TeamUnits> | null = null;
  /** Every team's yards gained and allowed through the air and on the ground this season, with ranks. */
  teamUnits(): Map<string, TeamUnits> {
    if (this.unitsCache) return this.unitsCache;
    type Acc = { weeks: Set<number>; passFor: number; rushFor: number; dWeeks: Set<number>; passAllowed: number; rushAllowed: number };
    const acc = new Map<string, Acc>();
    const get = (t: string): Acc => {
      let x = acc.get(t);
      if (!x) { x = { weeks: new Set(), passFor: 0, rushFor: 0, dWeeks: new Set(), passAllowed: 0, rushAllowed: 0 }; acc.set(t, x); }
      return x;
    };
    for (const r of this.cur) {
      const o = get(r.team); o.weeks.add(r.week); o.passFor += r.v.passing_yards; o.rushFor += r.v.rushing_yards;
      const d = get(r.opp); d.dWeeks.add(r.week); d.passAllowed += r.v.passing_yards; d.rushAllowed += r.v.rushing_yards;
    }
    const per = [...acc.entries()].filter(([, x]) => x.weeks.size && x.dWeeks.size).map(([t, x]) => ({ t, games: x.weeks.size,
      passFor: x.passFor / x.weeks.size, rushFor: x.rushFor / x.weeks.size, passAllowed: x.passAllowed / x.dWeeks.size, rushAllowed: x.rushAllowed / x.dWeeks.size }));
    type K = "passFor" | "rushFor" | "passAllowed" | "rushAllowed";
    const rankOf = (k: K, desc: boolean) => {
      const order = [...per].sort((a, b) => (desc ? b[k] - a[k] : a[k] - b[k])).map((x) => x.t);
      return (t: string) => order.indexOf(t) + 1;
    };
    const rk = { passFor: rankOf("passFor", true), rushFor: rankOf("rushFor", true), passAllowed: rankOf("passAllowed", false), rushAllowed: rankOf("rushAllowed", false) };
    this.unitsCache = new Map(per.map((x) => [x.t, { games: x.games, passFor: x.passFor, rushFor: x.rushFor, passAllowed: x.passAllowed, rushAllowed: x.rushAllowed,
      rank: { passFor: rk.passFor(x.t), rushFor: rk.rushFor(x.t), passAllowed: rk.passAllowed(x.t), rushAllowed: rk.rushAllowed(x.t) } }]));
    return this.unitsCache;
  }

  /** What a defense allows to a position for one stat, per game, and its rank (1 = allows the most). */
  private allowedTo(opp: string, group: string, stat: NflStat): { perGame: number; rank: number; of: number } | null {
    const allowed = new Map<string, { sum: number; games: Set<number> }>();
    for (const r of this.cur) {
      if (posGroup(r.pos) !== group) continue;
      const a = allowed.get(r.opp) ?? { sum: 0, games: new Set<number>() };
      a.sum += statValue(r, stat); a.games.add(r.week); allowed.set(r.opp, a);
    }
    const list = [...allowed.entries()].map(([t, a]) => ({ t, pg: a.sum / Math.max(1, a.games.size) })).sort((a, b) => b.pg - a.pg);
    const i = list.findIndex((x) => x.t === opp);
    return i < 0 ? null : { perGame: list[i].pg, rank: i + 1, of: list.length };
  }

  private oppFactor(opp: string, group: string, stat: NflStat): { f: number; games: number } {
    const allowed = new Map<string, { sum: number; games: Set<number> }>();
    for (const r of this.cur) {
      if (posGroup(r.pos) !== group) continue;
      const a = allowed.get(r.opp) ?? { sum: 0, games: new Set<number>() };
      a.sum += statValue(r, stat); a.games.add(r.week); allowed.set(r.opp, a);
    }
    const perGame = [...allowed.values()].map((a) => a.sum / Math.max(1, a.games.size));
    const league = perGame.reduce((x, y) => x + y, 0) / Math.max(1, perGame.length);
    const me = allowed.get(opp);
    if (!me || !league) return { f: 1, games: 0 };
    const g = me.games.size;
    const raw = me.sum / g / league;
    return { f: Math.max(0.8, Math.min(1.2, 1 + (raw - 1) * (g / (g + OPP_PRIOR)))), games: g };
  }

  /**
   * Projection for one player and stat against an opponent (nflverse abbreviation).
   * scriptFactor: the team's projected points vs its usual output (applied gently to passing/receiving/TDs).
   */
  project(player: string, stat: NflStat, opp: string, scriptFactor = 1, scriptCap = 0.06, usage: { factor: number; note: string } | null = null): (PlayerProjection & { note: string; games: number; pos: string; parts: WhyPart[] }) | null {
    const n = norm(player);
    const mine = this.cur.filter((r) => norm(r.name) === n);
    const last = this.prev.filter((r) => norm(r.name) === n);
    if (!mine.length && !last.length) return null;
    const pos = (mine[0] ?? last[0]).pos;
    const curMean = mine.length ? mine.reduce((s, r) => s + statValue(r, stat), 0) / mine.length : 0;
    const prevMean = last.length ? last.reduce((s, r) => s + statValue(r, stat), 0) / last.length : curMean;
    let base: number;
    if (stat === "anytime_td" || stat === "passing_tds") {
      // TDs are the noisiest stat: lean on last season (8 games' worth) and the position's typical rate (4 games' worth)
      const typical = stat === "passing_tds" ? 1.4 : posGroup(pos) === "RB" ? 0.35 : posGroup(pos) === "REC" ? 0.25 : 0.15;
      const prevW = last.length ? 8 : 0;
      base = (curMean * mine.length + prevMean * prevW + typical * 4) / (mine.length + prevW + 4);
    } else {
      const k = last.length ? PRIOR_GAMES : 0;
      base = (curMean * mine.length + prevMean * k) / Math.max(1, mine.length + k);
    }
    if (base <= 0 && stat !== "anytime_td") return null;
    const raw = this.oppFactor(opp, posGroup(pos), stat);
    const isTd = stat === "anytime_td" || stat === "passing_tds";
    const opp_f = isTd ? 1 + (raw.f - 1) * 0.5 : raw.f;
    const oppGames = raw.games;
    const scriptApplies = stat !== "rushing_yards";
    const script = scriptApplies ? Math.max(1 - scriptCap, Math.min(1 + scriptCap, scriptFactor)) : 1;
    const mean = Math.max(0.05, base * opp_f * script * (usage?.factor ?? 1));
    const group = posGroup(pos);
    const statWords: Record<NflStat, string> = { passing_yards: "passing yards", rushing_yards: "rushing yards", receiving_yards: "receiving yards",
      receptions: "catches", anytime_td: "touchdowns", passing_tds: "passing TDs" };
    const who = group === "QB" ? "quarterbacks" : group === "RB" ? "running backs" : "receivers and tight ends";
    const gp = mine.length;
    const touches = mine.reduce((s2, r) => s2 + (stat === "rushing_yards" ? r.v.carries : stat === "receiving_yards" || stat === "receptions" ? r.v.targets : 0), 0);
    const usageTxt = stat === "rushing_yards" ? ` on ${touches} carries` : stat === "receiving_yards" || stat === "receptions" ? ` on ${touches} targets` : "";
    const oppTxt = Math.abs(opp_f - 1) < 0.02 ? `${opp} is about average at stopping ${who}` + ` (${statWords[stat]})`
      : `${opp} gives up ${Math.abs(Math.round((opp_f - 1) * 100))}% ${opp_f > 1 ? "more" : "fewer"} ${statWords[stat]} to ${who} than average${oppGames ? ` (${oppGames} games)` : ""}`;
    const scriptTxt = script === 1 ? "" : `; his team is projected to score ${script > 1 ? "a bit more" : "a bit less"} than usual`;
    const note = `${gp ? `${(curMean * gp).toFixed(0)} ${statWords[stat]} in ${gp} game${gp === 1 ? "" : "s"} this season (${curMean.toFixed(1)} a game${usageTxt})` : "No games this season"}`
      + `${last.length ? `, ${prevMean.toFixed(1)} a game last season` : ""}; ${oppTxt}${scriptTxt}.${usage ? ` ${usage.note}.` : ""}`;
    // the same reasons, one per line, each with its effect, for the "Why?" list
    const counts = stat === "receptions" || stat === "anytime_td" || stat === "passing_tds";
    const dec = counts ? 2 : 1;
    const parts: WhyPart[] = [{ k: "Our projection", text: `${mean.toFixed(dec)} ${statWords[stat]}`, v: mean }];
    const usageTotal = usageTxt ? ` (${usageTxt.trim().replace(/^on /, "")} total)` : "";
    parts.push({ k: "This season", text: gp ? `${curMean.toFixed(dec)} a game over ${gp} game${gp === 1 ? "" : "s"}${usageTotal}${last.length ? `; ${prevMean.toFixed(dec)} a game last season` : ""}` : `No games yet; ${prevMean.toFixed(dec)} a game last season` });
    const recent = [...mine].sort((a, b) => b.week - a.week).slice(0, 3);
    if (recent.length >= 2 && curMean > 0) {
      const r3 = recent.reduce((s, r) => s + statValue(r, stat), 0) / recent.length;
      const f3 = r3 / curMean;
      const trend = f3 > 1.15 ? "trending up" : f3 < 0.85 ? "trending down" : "about his average";
      parts.push({ k: `Last ${recent.length} games`, text: `${r3.toFixed(dec)} a game (${recent.map((r) => Math.round(statValue(r, stat))).join(", ")}), ${trend}`, f: f3, ctx: true });
    }
    const al = this.allowedTo(opp, group, stat);
    if (al) parts.push({ k: "Defense vs his position", text: `${opp} allows ${al.perGame.toFixed(dec)} ${statWords[stat]} a game to ${who}: ${al.rank <= al.of / 2 ? `${ordinal(al.rank)}-most` : `${ordinal(al.of - al.rank + 1)}-fewest`} of ${al.of}${oppGames ? ` (${oppGames} games)` : ""}`, f: opp_f });
    if (scriptApplies && script !== 1) parts.push({ k: "Game script", text: `His team is projected to score ${Math.abs(Math.round((scriptFactor - 1) * 100))}% ${scriptFactor > 1 ? "more" : "less"} than usual, so ${scriptFactor > 1 ? "more" : "fewer"} chances`, f: script });
    if (usage) parts.push({ k: "Teammates out", text: usage.note, f: usage.factor });
    if (counts) return { mean, median: mean, distribution: "poisson", note, games: gp, pos, parts };
    const q = this.ratios(stat, pos);
    if (q) {
      const median = mean * q[49];
      const spread = mean * (q[83] - q[15]) / 2;   // about one standard deviation, from real games
      return { mean, median, stdDev: Math.max(spread, 1), quantiles: q, distribution: "empirical", note, games: gp, pos, parts };
    }
    const sd = stat === "passing_yards" ? Math.max(45, mean * 0.22) : Math.max(15, mean * 0.55);
    return { mean, median: mean, stdDev: sd, distribution: "normal", note, games: gp, pos, parts };
  }
}
