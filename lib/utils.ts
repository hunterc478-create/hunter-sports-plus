import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtAmerican = (a: number) => (a > 0 ? `+${a}` : `${a}`);
export const fmtPct = (p: number, digits = 1) => `${(p * 100).toFixed(digits)}%`;
export const fmtEdge = (e: number) => `${e >= 0 ? "+" : ""}${(e * 100).toFixed(1)} pts`;
export const fmtUnits = (u: number) => `${u >= 0 ? "+" : ""}${u.toFixed(2)}u`;

export function fmtKickoff(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
}
