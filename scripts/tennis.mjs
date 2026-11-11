/**
 * Tennis picks from Kalshi match markets + a player rating model (Elo).
 *
 *   history  public/data/tennis-results-v4.json   every finished match we know: Kalshi settled match markets (ATP, WTA,
 *                                              Challengers), ESPN main-tour results, and Jeff Sackmann's files when
 *                                              they exist. Carried over between runs; only new results are fetched.
 *   out      public/data/tennis-cands.json     { updatedAt, cands: [...], results: { [eventTicker]: winnerName } }
 *            (scripts/picks.ts logs, locks and grades the candidates like every other sport)
 *
 * Model: Elo per tour (start 1500, K shrinking with matches played). The chance used for a pick blends the market
 * (60%) with the rating (40%), so the model nudges the price instead of overriding it until it has a track record.
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.join("public", "data");
const SITE = (process.env.SITE_URL || "https://hunterc478-create.github.io/hunter-sports-plus").replace(/\/$/, "");
const KAL = "https://api.elections.kalshi.com/trade-api/v2";
const SERIES = { KXATPMATCH: "ATP", KXATPCHALLENGERMATCH: "ATP", KXWTAMATCH: "WTA", KXWTACHALLENGERMATCH: "WTA" };
const CHALL = /CHALLENGER/;
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch { return null; } };
async function get(url, type = "json") {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { "user-agent": "sports-plus" } }); if (r.ok) return type === "json" ? r.json() : r.text(); if (r.status === 404) return null; } catch {}
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}
const key = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim().replace(/\s+/g, " ");
const shortName = (s) => { const p = String(s).trim().split(/\s+/); return p.length > 1 ? p.slice(-1)[0] : s; };
const r3 = (x) => Math.round(x * 1000) / 1000;
const amer = (p) => (p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
const fee = (a) => Math.ceil(0.07 * a * (1 - a) * 100) / 100;              // Kalshi taker fee per contract
const tourneyOf = (m) => (String(m.rules_primary || "").match(/match in the \d{4} (.+?) (?:\d\/\d+ Finals|Quarterfinals?|Semifinals?|Final|Group Stage|Round of \d+|Qualifying.*?)\b/) || [])[1] || "";

/* ---------------- history ---------------- */
async function kalshiMarkets(series, status, minCloseTs) {
  const out = []; let cursor = "";
  for (let page = 0; page < 60; page++) {
    const q = `${KAL}/markets?series_ticker=${series}&status=${status}&limit=1000${minCloseTs ? `&min_close_ts=${minCloseTs}` : ""}${cursor ? `&cursor=${cursor}` : ""}`;
    const d = await get(q);
    if (!d) break;
    out.push(...(d.markets || []));
    cursor = d.cursor; if (!cursor || !(d.markets || []).length) break;
  }
  return out;
}
function kalshiResults(markets, tour, chall) {
  const ev = new Map();
  for (const m of markets) { const a = ev.get(m.event_ticker) || []; a.push(m); ev.set(m.event_ticker, a); }
  const res = [];
  for (const [t, ms] of ev) {
    const yes = ms.find((m) => m.result === "yes"), no = ms.find((m) => m.result === "no");
    if (!yes || !no || !yes.yes_sub_title || !no.yes_sub_title) continue;
    res.push({ id: "k:" + t, d: (yes.occurrence_datetime || yes.close_time || "").slice(0, 10), w: yes.yes_sub_title, l: no.yes_sub_title, tour, ch: chall ? 1 : 0, src: "kalshi" });
  }
  return res;
}
async function espnWeeks(tour, fromIso) {
  const res = [];
  const start = new Date(fromIso), end = new Date();
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 3)) days.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  const boards = await Promise.all(days.map((d) => get(`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour.toLowerCase()}/scoreboard?dates=${d}`)));
  for (const b of boards) for (const e of b?.events || []) for (const g of e.groupings || []) {
    const gname = g.grouping?.displayName || "";
    if (!/singles/i.test(gname)) continue;
    const gtour = /women/i.test(gname) ? "WTA" : /men/i.test(gname) ? "ATP" : tour;     // combined events list both tours
    for (const c of g.competitions || []) {
      if (c.status?.type?.state !== "post") continue;
      const W = (c.competitors || []).find((x) => x.winner), Lz = (c.competitors || []).find((x) => !x.winner);
      if (!W?.athlete?.displayName || !Lz?.athlete?.displayName) continue;
      const sets = (W.linescores || []).length;
      if (!sets) continue;                                  // walkovers
      const games = [...(W.linescores || []), ...(Lz.linescores || [])].reduce((t, x) => t + (Number(x.value) || 0), 0);
      // ESPN says 5 for every ATP match; only men's Grand Slam main draws are best of 5
      const bo = gtour === "ATP" && /australian open|roland garros|french open|wimbledon|us open/i.test(e.name || "") && !/qualif/i.test(c.round?.displayName || "") ? 5 : 3;
      const done = /final/i.test(c.status?.type?.description || "") && !/retire|walkover|default/i.test(JSON.stringify(c.notes || ""));
      res.push({ id: "e:" + c.id, d: (c.date || "").slice(0, 10), w: W.athlete.displayName, l: Lz.athlete.displayName, tour: gtour, ch: 0, src: "espn", g: done ? games : undefined, bo });
    }
  }
  return res;
}
// today's order of play from ESPN: real start times (they move with delays) and whether a match is on court
async function espnSchedule() {
  const out = [], now = Date.now();
  const days = [-1, 0, 1].map((o) => new Date(now + o * 86400_000).toISOString().slice(0, 10).replace(/-/g, ""));
  const boards = await Promise.all(["atp", "wta"].flatMap((t) => days.map((d) => get(`https://site.api.espn.com/apis/site/v2/sports/tennis/${t}/scoreboard?dates=${d}`))));
  for (const b of boards) for (const e of b?.events || []) for (const g of e.groupings || []) {
    if (!/singles/i.test(g.grouping?.displayName || "")) continue;
    for (const c of g.competitions || []) {
      const n = (c.competitors || []).map((x) => x.athlete?.displayName).filter(Boolean);
      if (n.length !== 2 || !c.date) continue;
      out.push({ a: n[0], b: n[1], date: c.date, state: c.status?.type?.state || "pre", detail: c.status?.type?.shortDetail || "" });
    }
  }
  return out;
}
async function sackmann(year) {
  const res = [];
  const files = [["tennis_atp", `atp_matches_${year}.csv`, "ATP", 0], ["tennis_atp", `atp_matches_qual_chall_${year}.csv`, "ATP", 1], ["tennis_wta", `wta_matches_${year}.csv`, "WTA", 0], ["tennis_wta", `wta_matches_qual_itf_${year}.csv`, "WTA", 1]];
  for (const [repo, f, tour, ch] of files) {
    const t = await get(`https://raw.githubusercontent.com/JeffSackmann/${repo}/master/${f}`, "text");
    if (!t) continue;
    const lines = t.trim().split("\n"), hd = lines[0].split(","), ix = (k) => hd.indexOf(k);
    const [iD, iW, iL, iS, iT] = ["tourney_date", "winner_name", "loser_name", "score", "tourney_id"].map(ix);
    for (const l of lines.slice(1)) {
      const c = l.split(",");
      if (/W\/O|RET|DEF/i.test(c[iS] || "") && !/\d-\d/.test(c[iS] || "")) continue;
      const d = c[iD]; res.push({ id: `s:${c[iT]}:${key(c[iW])}:${key(c[iL])}`, d: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, w: c[iW], l: c[iL], tour, ch, src: "sackmann" });
    }
  }
  return res;
}

/* ---------------- Elo ---------------- */
function rate(results) {
  const R = { ATP: new Map(), WTA: new Map() };
  const sorted = [...results].sort((a, b) => a.d.localeCompare(b.d));
  // the same match from two sources (Kalshi + ESPN): keep the first
  const seen = new Set();
  for (const m of sorted) {
    const k = `${m.tour}|${m.d}|${[key(m.w), key(m.l)].sort().join("|")}`, k2 = `${m.tour}|${[key(m.w), key(m.l)].sort().join("|")}`;
    if (seen.has(k) || seen.has(k2 + "|" + m.d.slice(0, 8))) continue;
    seen.add(k);
    const T = R[m.tour]; if (!T) continue;
    const pw = T.get(key(m.w)) || { r: 1500, n: 0, form: [], name: m.w, h2h: {} }, pl = T.get(key(m.l)) || { r: 1500, n: 0, form: [], name: m.l, h2h: {} };
    const ew = 1 / (1 + 10 ** ((pl.r - pw.r) / 400));
    if (m.g) { m.pre = Math.min(ew, 1 - ew); (pw.gm ||= []).unshift(m); (pl.gm ||= []).unshift(m); if (pw.gm.length > 25) pw.gm.length = 25; if (pl.gm.length > 25) pl.gm.length = 25; }
    const kw = 250 / (pw.n + 5) ** 0.4, kl = 250 / (pl.n + 5) ** 0.4;
    pw.r += kw * (1 - ew); pl.r -= kl * (1 - ew);
    pw.n++; pl.n++;
    pw.form.unshift(1); pl.form.unshift(0); pw.form.length = Math.min(pw.form.length, 10); pl.form.length = Math.min(pl.form.length, 10);
    pw.last = pl.last = m.d;
    (pw.h2h[key(m.l)] ||= [0, 0])[0]++; (pl.h2h[key(m.w)] ||= [0, 0])[1]++;
    T.set(key(m.w), pw); T.set(key(m.l), pl);
  }
  return R;
}

/* ---------------- main ---------------- */
async function main() {
  const now = Date.now();
  let hist = read("tennis-results-v4.json") || (await get(`${SITE}/data/tennis-results-v4.json`)) || { results: [], kalshiUntil: 0, espnUntil: null };
  const have = new Set(hist.results.map((r) => r.id));
  const add = (rs) => { let n = 0; for (const r of rs) if (r.d && !have.has(r.id)) { have.add(r.id); hist.results.push(r); n++; } return n; };
  const firstRun = hist.results.length === 0;
  let added = 0;
  if (firstRun) {
    const y = new Date().getFullYear();
    for (const yr of [y - 1, y]) added += add(await sackmann(yr));
  }
  // Kalshi settled results since the last run (two days of overlap)
  const since = hist.kalshiUntil ? Math.floor(hist.kalshiUntil / 1000) - 2 * 86400 : 0;
  for (const [s, tour] of Object.entries(SERIES)) added += add(kalshiResults(await kalshiMarkets(s, "settled", since), tour, CHALL.test(s)));
  hist.kalshiUntil = now;
  // ESPN main tour since the last run (a year back the first time)
  const espnFrom = hist.espnUntil ? new Date(new Date(hist.espnUntil).getTime() - 4 * 86400_000).toISOString().slice(0, 10) : new Date(now - 330 * 86400_000).toISOString().slice(0, 10);
  for (const tour of ["ATP", "WTA"]) added += add(await espnWeeks(tour, espnFrom));
  hist.espnUntil = new Date(now).toISOString();
  // keep about 18 months
  const cut = new Date(now - 550 * 86400_000).toISOString().slice(0, 10);
  hist.results = hist.results.filter((r) => r.d >= cut);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, "tennis-results-v4.json"), JSON.stringify(hist));

  const R = rate(hist.results);
  console.log(`tennis: history ${hist.results.length} matches (+${added} new) · rated ${R.ATP.size} ATP / ${R.WTA.size} WTA players · sources ${JSON.stringify(hist.results.reduce((a, r) => ((a[r.src] = (a[r.src] || 0) + 1), a), {}))}`);

  for (const tour of ["ATP", "WTA"]) console.log(`tennis: top ${tour} ratings · ` + [...R[tour].values()].filter((p) => p.n >= 20).sort((a, b) => b.r - a.r).slice(0, 10).map((p) => `${p.name} ${Math.round(p.r)} (${p.n})`).join(", "));
  // open matches on Kalshi
  const cands = [], results = {};
  let open = 0, rated = 0;
  for (const [s, tour] of Object.entries(SERIES)) {
    const ms = await kalshiMarkets(s, "open");
    // recent settled, for grading picks
    for (const r of kalshiResults(await kalshiMarkets(s, "settled", Math.floor(now / 1000) - 6 * 86400), tour, false)) results[r.id.slice(2)] = r.w;
    const ev = new Map();
    for (const m of ms) { const a = ev.get(m.event_ticker) || []; a.push(m); ev.set(m.event_ticker, a); }
    for (const [t, pair] of ev) {
      if (pair.length !== 2) continue;
      open++;
      const [A, B] = pair;
      const start = A.occurrence_datetime || A.expected_expiration_time;
      if (!start || new Date(start).getTime() <= now) continue;
      const ask = (m) => Number(m.yes_ask_dollars), bid = (m) => Number(m.yes_bid_dollars);
      if (!(ask(A) > 0 && ask(B) > 0 && ask(A) < 1 && ask(B) < 1)) continue;
      const pa = R[tour].get(key(A.yes_sub_title)), pb = R[tour].get(key(B.yes_sub_title));
      if (!pa || !pb || pa.n < 15 || pb.n < 15) continue;
      rated++;
      // market's chance: midpoint of each side, then normalized
      const midA = (ask(A) + (bid(A) || ask(A))) / 2, midB = (ask(B) + (bid(B) || ask(B))) / 2;
      const mktA = midA / (midA + midB);
      const eloA = 1 / (1 + 10 ** ((pb.r - pa.r) / 400));
      // the ratings can move the market by 5 points at most (big disagreements are usually the model being wrong)
      const pA = mktA + Math.max(-0.05, Math.min(0.05, 0.4 * (eloA - mktA)));
      const tourney = tourneyOf(A) || (CHALL.test(s) ? "Challenger" : tour);
      for (const [me, op, p, m, rme, rop] of [[A, B, pA, A, pa, pb], [B, A, 1 - pA, B, pb, pa]]) {
        const a = ask(m), cost = a + fee(a);
        const ev2 = p - cost, edge = ev2 / cost;
        if (edge < 0.015 || a < 0.25 || cost > 0.636) continue;      // nothing worse than -175
        const f = (x) => x.form.reduce((s2, v) => s2 + v, 0);
        const h = rme.h2h[key(op.yes_sub_title)];
        const why = [
          `Rated ${Math.round(rme.r)} vs ${Math.round(rop.r)}: the ratings give ${shortName(me.yes_sub_title)} ${Math.round(100 * (me === A ? eloA : 1 - eloA))}% to win`,
          `${shortName(me.yes_sub_title)} won ${f(rme)} of his/her last ${rme.form.length}; ${shortName(op.yes_sub_title)} won ${f(rop)} of ${rop.form.length}`,
          h ? `Head to head: ${shortName(me.yes_sub_title)} ${h[0]}-${h[1]}` : null,
          `Kalshi ${Math.round(a * 100)}¢ (${amer(a) > 0 ? "+" : ""}${amer(a)}); the market says ${Math.round(100 * (me === A ? mktA : 1 - mktA))}%, the ratings move it to ${Math.round(p * 100)}%`,
        ].filter(Boolean).map((x) => x.replace("his/her", tour === "WTA" ? "her" : "his"));
        const home = { name: A.yes_sub_title, short: shortName(A.yes_sub_title) }, away = { name: B.yes_sub_title, short: shortName(B.yes_sub_title) };
        cands.push({
          matchupId: t, league: tour, market: "moneyline", side: me === A ? "home" : "away", label: `${shortName(me.yes_sub_title)} ML`,
          home, away, start, book: "Kalshi", odds: amer(cost), fair: r3(p), ev: r3(edge), books: 1, tourney, why,
        });
      }
    }
  }
  /* ---------- total games ---------- */
  // how many games a match goes, by how close it is (pre-match chance of the underdog), per tour, best of 3
  const buckets = {};
  for (const m of hist.results) if (m.g && m.pre != null && m.bo === 3) {
    const b = `${m.tour}|${Math.min(4, Math.floor(m.pre / 0.1))}`;
    (buckets[b] ||= []).push(m.g);
  }
  const stat = (xs) => { const mu = xs.reduce((a, b) => a + b, 0) / xs.length; return { mu, sd: Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length), n: xs.length }; };
  const B = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, stat(v)]));
  const bucketOf = (tour, pre) => B[`${tour}|${Math.min(4, Math.floor(pre / 0.1))}`];
  const resid = (pl, tour) => { const xs = (pl.gm || []).filter((m) => m.bo === 3).map((m) => m.g - (bucketOf(tour, m.pre)?.mu ?? m.g)); return { r: xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) * (xs.length / (xs.length + 10)) : 0, n: xs.length, avg: xs.length ? (pl.gm.filter((m) => m.bo === 3).reduce((a, m) => a + m.g, 0) / xs.length) : null }; };
  const normCdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
  console.log(`tennis: total-games model · ` + Object.entries(B).sort().map(([k, v]) => `${k}: ${v.mu.toFixed(1)}±${v.sd.toFixed(1)} (${v.n})`).join(" · "));
  const totals = {};
  let tCands = 0; const tSkip = { started: 0, names: 0, unrated: 0, thin: 0, priced: 0, noEdge: 0 }; let bestSeen = -1;
  for (const [s, tour] of [["KXATPGTOTAL", "ATP"], ["KXWTAGTOTAL", "WTA"]]) {
    for (const m of await kalshiMarkets(s, "settled", Math.floor(now / 1000) - 6 * 86400)) if (m.result) totals[`${m.event_ticker}|${m.floor_strike}`] = m.result;
    const ms = await kalshiMarkets(s, "open");
    const ev = new Map();
    for (const m of ms) { const a = ev.get(m.event_ticker) || []; a.push(m); ev.set(m.event_ticker, a); }
    for (const [t, lines] of ev) {
      const m0 = lines[0];
      const start = m0.occurrence_datetime || m0.expected_expiration_time;
      if (!start || new Date(start).getTime() <= now) { tSkip.started++; continue; }
      const names = (String(m0.rules_primary || "").match(/above [\d.]+ in the (.+?) vs (.+?) professional tennis match/) || []).slice(1);
      if (names.length !== 2) { tSkip.names++; continue; }
      const [nA, nB] = names, pa = R[tour].get(key(nA)), pb = R[tour].get(key(nB));
      if (!pa || !pb) { tSkip.unrated++; continue; }
      const ra = resid(pa, tour), rb = resid(pb, tour);
      if (ra.n < 8 || rb.n < 8) { tSkip.thin++; continue; }
      tSkip.priced++;
      const eloA = 1 / (1 + 10 ** ((pb.r - pa.r) / 400)), pre = Math.min(eloA, 1 - eloA);
      const bk = bucketOf(tour, pre); if (!bk || bk.n < 50) continue;
      const mu = bk.mu + 0.5 * (ra.r + rb.r), sd = bk.sd;
      const h2h = hist.results.filter((x) => x.g && x.tour === tour && [key(x.w), key(x.l)].sort().join() === [key(nA), key(nB)].sort().join());
      let best = null;
      for (const m of lines) {
        const L = Number(m.floor_strike), ya = Number(m.yes_ask_dollars), na = Number(m.no_ask_dollars), yb = Number(m.yes_bid_dollars), nb = Number(m.no_bid_dollars);
        if (!Number.isFinite(L) || !(ya > 0 && na > 0)) continue;
        const mkt = ((ya + (yb || ya)) / 2) / (((ya + (yb || ya)) / 2) + ((na + (nb || na)) / 2));
        const model = 1 - normCdf((L - mu) / sd);
        const pO = mkt + Math.max(-0.05, Math.min(0.05, 0.4 * (model - mkt)));
        for (const [side, a, p] of [["over", ya, pO], ["under", na, 1 - pO]]) {
          const cost = a + fee(a), edge = p / cost - 1;
          if (a < 0.4 || cost > 0.6) continue;                       // totals: lines near even money only (-150 to +150)
          if (edge >= 0.015 && (!best || edge > best.edge)) best = { side, L, a, p, edge, model, mkt, cost };
        }
      }
      for (const m of lines) { const L = Number(m.floor_strike); const pm = 1 - normCdf((L - mu) / sd); bestSeen = Math.max(bestSeen, Math.abs(pm - Number(m.yes_ask_dollars))); }
      if (!best) { tSkip.noEdge++; continue; }
      const S = best.side === "over" ? "Over" : "Under";
      const hits = h2h.filter((x) => (best.side === "over" ? x.g > best.L : x.g < best.L)).length;
      const why = [
        `${shortName(nA)}'s matches average ${ra.avg.toFixed(1)} games; ${shortName(nB)}'s average ${rb.avg.toFixed(1)}`,
        `Ratings make it ${Math.round(100 * Math.max(eloA, 1 - eloA))}/${Math.round(100 * pre)}: ${pre >= 0.4 ? "a close matchup, which runs long" : pre <= 0.25 ? "a mismatch, which usually ends fast" : "a moderate favorite"} (about ${bk.mu.toFixed(1)} games for matchups like this)`,
        `Model projects ${mu.toFixed(1)} games vs this ${best.L} line`,
        h2h.length ? `Head to head: ${hits} of ${h2h.length} went ${best.side} ${best.L}` : null,
        `Kalshi ${Math.round(best.a * 100)}¢ (${amer(best.a) > 0 ? "+" : ""}${amer(best.a)}); market says ${Math.round(100 * (best.side === "over" ? best.mkt : 1 - best.mkt))}%, the model moves it to ${Math.round(100 * best.p)}%${lines.length > 1 ? ` · best of ${lines.length} lines` : ""}`,
      ].filter(Boolean);
      cands.push({ matchupId: t, league: tour, market: "total", side: best.side, line: best.L, label: `${S} ${best.L} games`,
        home: { name: nA, short: shortName(nA) }, away: { name: nB, short: shortName(nB) }, start, book: "Kalshi", odds: amer(best.cost), fair: r3(best.p), ev: r3(best.edge), books: 1, tourney: tourneyOf(m0), why });
      tCands++;
    }
  }
  console.log(`tennis: totals checked ${JSON.stringify(tSkip)} · biggest model-vs-price gap ${(bestSeen * 100).toFixed(0)} pts`);
  console.log(`tennis: ${tCands} total-games picks with 3%+ edge · ${Object.keys(totals).length} settled total lines for grading`);
  const sched = await espnSchedule().catch(() => []);
  console.log(`tennis: ${sched.length} matches on ESPN's order of play (${sched.filter((m) => m.state === "in").length} on court)`);
  fs.writeFileSync(path.join(DATA, "tennis-cands.json"), JSON.stringify({ updatedAt: new Date(now).toISOString(), cands, results, totals, sched }));
  console.log(`tennis: ${open} open Kalshi matches · ${rated} with both players rated · ${cands.length} picks with 3%+ edge · ${Object.keys(results).length} recent results for grading`);
  for (const c of cands.sort((a, b) => b.ev - a.ev).slice(0, 3)) console.log(`  ${c.tourney}: ${c.label} ${c.odds} · ${Math.round(c.fair * 100)}% · edge ${(c.ev * 100).toFixed(1)}%\n    - ${c.why.join("\n    - ")}`);
}
main().catch((e) => { console.error("tennis failed:", e); process.exitCode = 0; });
