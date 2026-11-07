# Hunter Sports Plus

Straight-bet picks for NBA, NHL, college hoops, soccer and tennis (moneylines + total games), each sport with its own
record (W-L, units, ROI, beat-the-close %). **Not a sportsbook: no bets are taken here.**
Live at `https://hunterc478-create.github.io/hunter-sports-plus/`.

- Page: `site/index.html` (one file). Picks + record: `public/data/picks.json`, written by `scripts/picks.ts`.
- A pick = one book's price beats the books' no-juice consensus by 2.5%+ (moneyline/spread/total, -250 to +300),
  one per game, logged inside 18 hours of the start with the price locked, graded from final scores, 1 unit flat.
- The odds/scores updater (`scripts/build-data.ts`) still runs every 30 minutes and feeds the picks.
- Old model (Oct 23 - Nov 7, 2026): 697 picks, -40.8u, mostly alt lines. Retired.

---

Older notes:

# Hunter Sports Plus

NBA, NHL, MLB, soccer, college basketball and tennis: odds from many books, our chance on every bet, props, parlays,
locks, My Bets and an auto-tracked record. Football lives on Hunter's Sauce.

**Not a sportsbook: no bets are taken here.** Live at `https://hunterc478-create.github.io/hunter-sports-plus/`.

Updates every 30 minutes from free sources (ESPN, Action Network, MLB.com, NHL.com, NBA.com, Kalshi, Open-Meteo);
The Odds API key (repo secret `THE_ODDS_API_KEY`) is used sparingly for props and missing lines.
