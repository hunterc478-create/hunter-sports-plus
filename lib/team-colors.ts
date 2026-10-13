/**
 * NFL team colors (ESPN abbreviations), tuned to read on a dark background: each team's brightest official color.
 * Used to tint game cards and game pages so every matchup looks like itself.
 */
const COLORS: Record<string, string> = {
  ARI: "#C8102E", ATL: "#D50A0A", BAL: "#6A4FB6", BUF: "#2F6FDB", CAR: "#0085CA", CHI: "#E0661B", CIN: "#FB4F14",
  CLE: "#FF6A13", DAL: "#2F5FD0", DEN: "#FB4F14", DET: "#0076B6", GB: "#FFB612", HOU: "#C8102E", IND: "#2A6FD6",
  JAX: "#009CA6", KC: "#E31837", LV: "#A5ACAF", LAC: "#0080C6", LAR: "#FFC20E", MIA: "#00A3AD", MIN: "#7B4FC8",
  NE: "#C60C30", NO: "#D3BC8D", NYG: "#2A55C9", NYJ: "#1E8A5A", PHI: "#00808B", PIT: "#FFB612", SF: "#C9243F",
  SEA: "#69BE28", TB: "#D50A0A", TEN: "#4B92DB", WSH: "#C1272D", WAS: "#C1272D",
};

export const teamColor = (abbr?: string) => (abbr && COLORS[abbr.toUpperCase()]) || "#6B7280";
/** ESPN's color for the team when it's bright enough to read on dark, else our NFL table, else gray. */
export function colorOf(t: { color?: string; abbreviation?: string }, league?: string): string {
  if (league === "NFL" && t.abbreviation && COLORS[t.abbreviation.toUpperCase()]) return COLORS[t.abbreviation.toUpperCase()];
  if (t.color) {
    const n = parseInt(t.color.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (0.2126 * r + 0.7152 * g + 0.0722 * b > 45) return t.color;   // very dark navies vanish on charcoal
  }
  return teamColor(t.abbreviation);
}

/** "#RRGGBB" plus an alpha (0-1) as "#RRGGBBAA". */
export const alpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
