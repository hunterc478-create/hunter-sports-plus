/** Pure odds math. No I/O, safe to use on the server and the client. */

export function impliedProb(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

export function toDecimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / -american;
}

export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) throw new Error("Decimal odds must be > 1");
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

export function probToAmerican(p: number): number {
  const q = Math.min(Math.max(p, 0.001), 0.999);
  return q >= 0.5 ? Math.round((-100 * q) / (1 - q)) : Math.round((100 * (1 - q)) / q);
}

/** Remove the bookmaker margin from a set of mutually exclusive outcomes (multiplicative method). */
export function devig(americans: number[]): number[] {
  const raw = americans.map(impliedProb);
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => r / total);
}

/** Expected profit per 1 unit staked. */
export function expectedValue(modelProb: number, american: number): number {
  return modelProb * (toDecimal(american) - 1) - (1 - modelProb);
}

/**
 * Fractional Kelly stake as a share of bankroll.
 * Default 1/4 Kelly and a 3% cap: full Kelly is far too aggressive when the model itself is uncertain.
 */
export function kellyFraction(modelProb: number, american: number, fraction = 0.25, cap = 0.03): number {
  const b = toDecimal(american) - 1;
  const k = (b * modelProb - (1 - modelProb)) / b;
  return Math.max(0, Math.min(cap, k * fraction));
}

export function parlayDecimal(americans: number[]): number {
  return americans.reduce((d, a) => d * toDecimal(a), 1);
}

// --- probability distributions used to price spreads, totals and props ---

/** Standard normal CDF (Abramowitz-Stegun approximation, |error| < 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** P(X > line) for X ~ Normal(mean, sd). */
export function probOverNormal(mean: number, sd: number, line: number): number {
  return 1 - normCdf((line - mean) / sd);
}

/** P(X > line) for X ~ Poisson(lambda). Lines are usually half-points (4.5 => P(X >= 5)). */
export function probOverPoisson(lambda: number, line: number): number {
  const k = Math.floor(line) + 1;
  let term = Math.exp(-lambda);
  let cdf = 0;
  for (let i = 0; i < k; i++) {
    cdf += term;
    term *= lambda / (i + 1);
  }
  return Math.max(0, 1 - cdf);
}

/** Inverse standard normal CDF (Acklam's approximation, |error| < 1.2e-9). */
export function normInv(p: number): number {
  const q0 = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (q0 < lo) { const q = Math.sqrt(-2 * Math.log(q0)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (q0 > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - q0)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = q0 - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
