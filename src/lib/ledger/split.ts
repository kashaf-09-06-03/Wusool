import type { Paisa } from "../money";

/**
 * Split an integer `total` across `weights` using the largest-remainder method.
 * - Results are integers that sum exactly to `total`.
 * - Ties are broken by input order, so the result is deterministic.
 * - Negative totals (discounts) are split by magnitude and negated.
 * BigInt is used so weight × total products never lose precision.
 */
export function splitByWeights(total: Paisa, weights: readonly number[]): Paisa[] {
  if (weights.length === 0) {
    if (total !== 0) throw new Error("Cannot split a non-zero amount across nobody");
    return [];
  }
  if (total < 0) return splitByWeights(-total, weights).map((v) => (v === 0 ? 0 : -v));
  // Scale fractional weights (e.g. percentages like 33.33) to integers.
  const scale = weights.some((w) => !Number.isInteger(w)) ? 1_000_000 : 1;
  const w = weights.map((x) => {
    if (!(x >= 0) || !Number.isFinite(x)) throw new Error(`Invalid weight ${x}`);
    return BigInt(Math.round(x * scale));
  });
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return splitByWeights(total, weights.map(() => 1));
  const T = BigInt(total);
  const base = w.map((wi) => (T * wi) / sum);
  const rema = w.map((wi, i) => ({ i, r: (T * wi) % sum }));
  let leftover = Number(T - base.reduce((a, b) => a + b, 0n));
  rema.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = base.map(Number);
  for (let k = 0; k < leftover; k++) out[rema[k].i] += 1;
  leftover = 0;
  return out;
}

/**
 * Split a matrix so that row i sums to rows[i] and column j sums to cols[j] (sum(rows) must equal
 * sum(cols)), proportionally (cell ≈ rows[i]·cols[j]/total), in multiples of `unit`.
 * Controlled rounding: floor every cell, then hand out the remaining units by largest fractional
 * part where both the row and the column still need them, then fill any leftovers (always feasible).
 * Falls back to per-row proportional splitting when values are negative or totals disagree.
 */
export function splitMatrix(rows: readonly number[], cols: readonly number[], unit = 1): number[][] {
  const T = rows.reduce((a, b) => a + b, 0);
  const C = cols.reduce((a, b) => a + b, 0);
  if (T !== C || T <= 0 || rows.some((v) => v < 0) || cols.some((v) => v < 0) || rows.some((v) => v % unit) || cols.some((v) => v % unit)) {
    return rows.map((r) => splitByWeights(r, cols.length ? cols.map((c) => Math.max(0, c)) : []));
  }
  const R = rows.map((v) => BigInt(v / unit));
  const K = cols.map((v) => BigInt(v / unit));
  const Tu = BigInt(T / unit);
  const out: bigint[][] = R.map((r) => K.map((k) => (r * k) / Tu));
  const rowDef = R.map((r, i) => r - out[i].reduce((a, b) => a + b, 0n));
  const colDef = K.map((k, j) => k - out.reduce((a, row) => a + row[j], 0n));
  const cells: { i: number; j: number; f: bigint }[] = [];
  R.forEach((r, i) => K.forEach((k, j) => cells.push({ i, j, f: (r * k) % Tu })));
  cells.sort((a, b) => (a.f === b.f ? a.i - b.i || a.j - b.j : a.f > b.f ? -1 : 1));
  for (const { i, j } of cells) {
    if (rowDef[i] > 0n && colDef[j] > 0n) {
      out[i][j] += 1n;
      rowDef[i] -= 1n;
      colDef[j] -= 1n;
    }
  }
  for (let i = 0; i < R.length; i++)
    for (let j = 0; j < K.length && rowDef[i] > 0n; j++) {
      const k = rowDef[i] < colDef[j] ? rowDef[i] : colDef[j];
      if (k > 0n) {
        out[i][j] += k;
        rowDef[i] -= k;
        colDef[j] -= k;
      }
    }
  return out.map((row) => row.map((v) => Number(v) * unit));
}

export function splitEqually(total: Paisa, count: number): Paisa[] {
  return splitByWeights(total, Array.from({ length: count }, () => 1));
}
