/**
 * MMA (UFC) fight moneylines.
 *   Prices: Kalshi UFC fight markets (KXUFCFIGHT, free) + sportsbooks from The Odds API (mma_mixed_martial_arts,
 *           1 credit a pull; only pulled when a fight is within 48h, at most every 8h, cached in mma-odds.json).
 *   Fair:   no-juice consensus of the books (needs 4+). A pick is a price that beats it (picks.ts decides).
 *   Why:    ESPN fight card: records, height/reach/stance/age, recent results.
 *   Grade:  ESPN results (winner flag). A draw / no contest / cancelled fight is void.
 *   out:    public/data/mma-cands.json { updatedAt, fights: [...], results: { [id]: winnerName | "void" } }
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.join("public", "data");
const SITE = (process.env.SITE_URL || "https://hunterc478-create.github.io/hunter-sports-plus").replace(/\/$/, "");
const KAL = "https://api.elections.kalshi.com/trade-api/v2";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc";
const now = Date.now();

async function get(url, withHeaders = false) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "sports-plus" } });
      if (r.ok) { const j = await r.json(); return withHeaders ? { j, h: r.headers } : j; }
      if (r.status === 404 || r.status === 401 || r.status === 422) return null;
    } catch {}
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch { return null; } };
const key = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").trim().replace(/\s+/g, " ");
const last = (s) => key(s).split(" ").pop() || "";
const pairKey = (a, b) => [last(a), last(b)].sort().join("|");
const amer = (p) => (p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p));
const fee = (a) => Math.ceil(0.07 * a * (1 - a) * 100) / 100;
const imp = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
const r3 = (x) => Math.round(x * 1000) / 1000;
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

/* ---------- Kalshi fights ---------- */
async function kalshi() {
  const fights = new Map(); let cursor = "";
  for (let i = 0; i < 10; i++) {
    const j = await get(`${KAL}/markets?series_ticker=KXUFCFIGHT&status=open&limit=200${cursor ? "&cursor=" + cursor : ""}`);
    for (const m of j?.markets || []) {
      const f = fights.get(m.event_ticker) || { id: m.event_ticker, sides: [], start: m.occurrence_datetime || m.expected_expiration_time };
      f.sides.push({ name: m.yes_sub_title, ask: Number(m.yes_ask_dollars) || 0 });
      fights.set(m.event_ticker, f);
    }
    cursor = j?.cursor; if (!cursor) break;
  }
  return [...fights.values()].filter((f) => f.sides.length === 2 && new Date(f.start).getTime() > now - 6 * 3600_000);
}

/* ---------- sportsbooks (The Odds API), cached ---------- */
async function books(soon) {
  let cache = read("mma-odds.json") || (await get(`${SITE}/data/mma-odds.json`));
  const age = cache?.fetchedAt ? (now - new Date(cache.fetchedAt).getTime()) / 3600_000 : 1e9;
  const K = process.env.THE_ODDS_API_KEY;
  if (K && soon && (age > 8 || process.env.FORCE_PROPS === "true")) {
    const r = await get(`https://api.the-odds-api.com/v4/sports/mma_mixed_martial_arts/odds?apiKey=${K}&regions=us,us2&markets=h2h&oddsFormat=american`, true);
    if (r?.j) { cache = { fetchedAt: new Date(now).toISOString(), events: r.j }; console.log(`mma: pulled sportsbook lines (${r.j.length} fights, ${r.h.get("x-requests-remaining")} credits left)`); }
  }
  fs.mkdirSync(DATA, { recursive: true });
  if (cache) fs.writeFileSync(path.join(DATA, "mma-odds.json"), JSON.stringify(cache));
  return cache;
}

/* ---------- ESPN cards (schedule, records, results) ---------- */
async function espnCards(days) {
  const out = [];
  for (const d of days) {
    const b = await get(`${ESPN}/scoreboard?dates=${d}`);
    for (const e of b?.events || []) for (const c of e.competitions || []) {
      const cs = (c.competitors || []).filter((x) => x.athlete?.displayName);
      if (cs.length !== 2) continue;
      out.push({ event: e.name, id: c.id, date: c.date, state: c.status?.type?.state, desc: c.status?.type?.description || "",
        f: cs.map((x) => ({ id: x.id, name: x.athlete.displayName, rec: x.records?.[0]?.summary || "", winner: !!x.winner })) });
    }
  }
  const seen = new Set();
  return out.filter((c) => !seen.has(c.id) && seen.add(c.id));
}
async function athlete(id) {
  const a = await get(`https://sports.core.api.espn.com/v2/sports/mma/athletes/${id}`);
  return a ? { h: a.displayHeight, reach: a.displayReach || (a.reach ? `${a.reach}"` : ""), reachN: Number(a.reach) || null, age: a.age, stance: a.stance?.text || a.stance?.displayName || "", hasLog: !!a.eventLog } : null;
}
async function recent(id) {
  const j = await get(`https://site.web.api.espn.com/apis/common/v3/sports/mma/athletes/${id}/fights`)
    || await get(`https://site.web.api.espn.com/apis/common/v3/sports/mma/athletes/${id}/overview`);
  return j;
}
const recParse = (s) => { const [w, l, d] = String(s).split("-").map(Number); return { w: w || 0, l: l || 0, d: d || 0 }; };

async function main() {
  const fights = await kalshi();
  const soon = fights.some((f) => { const h = (new Date(f.start).getTime() - now) / 3600_000; return h > 0 && h < 48; });
  const cache = await books(soon);
  // ESPN days covering the open Kalshi fights + the last 4 days for grading
  const days = new Set([...[-4, -3, -2, -1, 0, 1].map((o) => ymd(now + o * 86400_000)), ...fights.map((f) => ymd(f.start))]);
  const cards = await espnCards([...days]);
  const cardBy = new Map(cards.map((c) => [pairKey(c.f[0].name, c.f[1].name), c]));

  // results for grading (by Kalshi event id and by fighter pair)
  const prev = read("mma-cands.json") || (await get(`${SITE}/data/mma-cands.json`));
  const results = { ...(prev?.results || {}) };
  for (const c of cards) {
    if (c.state !== "post") continue;
    const w = c.f.find((x) => x.winner);
    results[pairKey(c.f[0].name, c.f[1].name)] = w ? w.name : "void";       // no winner = draw / no contest
  }
  for (const c of cards) if (c.state === "post" && /cancel|postpon/i.test(c.desc)) results[pairKey(c.f[0].name, c.f[1].name)] = "void";

  const out = []; let sample = null, noBooks = 0;
  for (const f of fights) {
    const [A, B] = f.sides, pk = pairKey(A.name, B.name);
    const ev = (cache?.events || []).find((e) => pairKey(e.home_team, e.away_team) === pk);
    const card = cardBy.get(pk);
    // book prices per side + no-juice consensus
    const per = { [A.name]: [], [B.name]: [] }, fairs = [];
    for (const bk of ev?.bookmakers || []) {
      const o = bk.markets?.find((m) => m.key === "h2h")?.outcomes || [];
      const oa = o.find((x) => last(x.name) === last(A.name)), ob = o.find((x) => last(x.name) === last(B.name));
      if (!oa || !ob) continue;
      per[A.name].push({ name: bk.title, odds: oa.price }); per[B.name].push({ name: bk.title, odds: ob.price });
      const x = imp(oa.price), y = imp(ob.price); fairs.push(x / (x + y));
    }
    if (fairs.length < 4) { noBooks++; continue; }
    const pA = median(fairs);
    for (const [S, fair] of [[A, pA], [B, 1 - pA]]) {
      if (S.ask > 0.03 && S.ask < 0.97) { const cost = S.ask + fee(S.ask); per[S.name].push({ name: "Kalshi", odds: amer(cost) }); }
    }
    // the why
    const why = [];
    if (card) {
      const ath = await Promise.all(card.f.map((x) => athlete(x.id)));
      const fa = card.f.find((x) => last(x.name) === last(A.name)) || card.f[0], fb = card.f.find((x) => x !== fa);
      const ia = card.f.indexOf(fa), ib = card.f.indexOf(fb);
      const ra = recParse(fa.rec), rb = recParse(fb.rec);
      if (fa.rec && fb.rec) why.push(`Records: ${A.name} ${fa.rec} · ${B.name} ${fb.rec}`);
      const a1 = ath[ia], b1 = ath[ib];
      if (a1?.reachN && b1?.reachN && Math.abs(a1.reachN - b1.reachN) >= 2) {
        const [lo, hi] = a1.reachN > b1.reachN ? [B.name, A.name] : [A.name, B.name];
        why.push(`Reach: ${hi} has ${Math.abs(a1.reachN - b1.reachN)}" more reach than ${lo}`);
      }
      if (a1?.age && b1?.age && Math.abs(a1.age - b1.age) >= 5) why.push(`Age: ${a1.age > b1.age ? A.name : B.name} is ${Math.abs(a1.age - b1.age)} years older (${Math.max(a1.age, b1.age)} vs ${Math.min(a1.age, b1.age)})`);
      if (a1?.stance && b1?.stance && a1.stance !== b1.stance) why.push(`Stances: ${A.name} ${a1.stance.toLowerCase()}, ${B.name} ${b1.stance.toLowerCase()}`);
      const ex = (r) => r.w + r.l ? Math.round((100 * r.w) / (r.w + r.l)) : null;
      if (ra.w + ra.l >= 5 && rb.w + rb.l >= 5) why.push(`Win rate: ${A.name} ${ex(ra)}% · ${B.name} ${ex(rb)}% over their careers`);
      if (!sample) sample = { a: a1, rec: await recent(fa.id).then((j) => j && Object.keys(j)) };
    }
    out.push({ id: f.id, pk, event: card?.event || "UFC", start: card?.date || f.start,
      a: { name: A.name, espn: card?.f.find((x) => last(x.name) === last(A.name))?.id }, b: { name: B.name, espn: card?.f.find((x) => last(x.name) === last(B.name))?.id },
      fairA: r3(pA), nBooks: fairs.length, books: per, why });
  }
  fs.writeFileSync(path.join(DATA, "mma-cands.json"), JSON.stringify({ updatedAt: new Date(now).toISOString(), fights: out, results }));
  console.log(`mma: ${fights.length} open Kalshi fights · ${out.length} with 4+ books · ${noBooks} without book lines · ${cards.length} ESPN fights · ${Object.keys(results).length} results`);
  if (sample) console.log(`mma: athlete sample ${JSON.stringify(sample).slice(0, 300)}`);
  if (out[0]) console.log(`mma: why sample ${out[0].a.name} vs ${out[0].b.name}:\n  - ${out[0].why.join("\n  - ")}`);
}
main().catch((e) => { console.error("mma failed:", e); });
