/**
 * Translate a pick into Kalshi's wording, e.g.
 *   Seahawks -3   -> Yes · Seahawks win by over 2.5
 *   Ducks +1.5    -> No · Panthers win by over 1.5
 *   Under 44.5    -> No · Over 44.5 points
 * Whole-number lines (-3, +3, 44) map to the Kalshi rung where a sportsbook push counts as a win.
 */
export function kalshiPhrase(market: string, side: string, line: number | undefined, home: string, away: string): string | null {
  const team = side === "home" ? home : away;
  const other = side === "home" ? away : home;
  const plural = (t: string) => (/s$/.test(t) ? `${t} win` : `${t} wins`);
  if (market === "moneyline") return side === "draw" ? "Yes · Tie" : `Yes · ${plural(team)}`;
  if ((market === "spread" || market === "alt_spread") && line !== undefined) {
    if (line < 0) {
      const L = Math.abs(line);
      return `Yes · ${plural(team)} by over ${Number.isInteger(L) ? L - 0.5 : L}`;
    }
    return `No · ${plural(other)} by over ${Number.isInteger(line) ? line + 0.5 : line}`;
  }
  if ((market === "total" || market === "alt_total") && line !== undefined) {
    if (side === "over") return `Yes · Over ${Number.isInteger(line) ? line - 0.5 : line} points`;
    return `No · Over ${Number.isInteger(line) ? line + 0.5 : line} points`;
  }
  return null;
}

/** Player props on Kalshi read "Player: 80+": Over = Yes, Under = No. */
export function kalshiPropPhrase(player: string, statLabel: string, side: string): string {
  return `${side === "over" ? "Yes" : "No"} · ${player}: ${statLabel}`;
}
