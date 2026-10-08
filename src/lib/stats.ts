/** Numerical helpers for screening, weighting and composite indices. */

import { gauss, mulberry32 } from "./prng";

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.trim().replace(/,/g, "");
    if (!t || t === "NA" || t === "na" || t === "-" || t === "—") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function colValues(rows: Record<string, unknown>[], key: string): (number | null)[] {
  return rows.map((r) => toNum(r[key]));
}

export function finite(xs: (number | null | undefined)[]): number[] {
  return xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
}

export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs: number[], sample = true): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / (sample ? n - 1 : n);
}

export function sd(xs: number[], sample = true): number {
  const v = variance(xs, sample);
  return Number.isFinite(v) ? Math.sqrt(v) : NaN;
}

export function minMax(xs: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return { min, max };
}

export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const m = mean(xs);
  const s = sd(xs);
  if (!s) return 0;
  let a = 0;
  for (const x of xs) a += ((x - m) / s) ** 3;
  return (n / ((n - 1) * (n - 2))) * a;
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i]! - ma;
    const xb = b[i]! - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) return NaN;
  return num / Math.sqrt(da * db);
}

export function pairwisePearson(a: (number | null)[], b: (number | null)[]): number {
  const aa: number[] = [];
  const bb: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) {
      aa.push(x);
      bb.push(y);
    }
  }
  return pearson(aa, bb);
}

export function pairwisePearsonW(a: (number | null)[], b: (number | null)[], w: number[]): number {
  const n = Math.min(a.length, b.length, w.length);
  let sw = 0;
  let sax = 0;
  let sbx = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    const wi = w[i]!;
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) || !(wi > 0)) continue;
    sw += wi;
    sax += wi * x;
    sbx += wi * y;
  }
  if (sw <= 0) return NaN;
  const ma = sax / sw;
  const mb = sbx / sw;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    const wi = w[i]!;
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) || !(wi > 0)) continue;
    const xa = x - ma;
    const xb = y - mb;
    num += wi * xa * xb;
    da += wi * xa * xa;
    db += wi * xb * xb;
  }
  if (da === 0 || db === 0) return NaN;
  return num / Math.sqrt(da * db);
}

export function corrMatrix(cols: (number | null)[][], weights?: number[]): number[][] {
  const p = cols.length;
  const R = Array.from({ length: p }, () => Array<number>(p).fill(1));
  const w = weights && weights.length ? weights : null;
  for (let i = 0; i < p; i++) {
    R[i]![i] = 1;
    for (let j = i + 1; j < p; j++) {
      const r = w ? pairwisePearsonW(cols[i]!, cols[j]!, w) : pairwisePearson(cols[i]!, cols[j]!);
      const v = Number.isFinite(r) ? r : 0;
      R[i]![j] = v;
      R[j]![i] = v;
    }
  }
  return R;
}

export function invertMatrix(A: number[][]): number[][] | null {
  const n = A.length;
  if (!n) return null;
  const m = A.map((row, i) => {
    const r = row.slice();
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(m[col]![col]!);
    for (let i = col + 1; i < n; i++) {
      const v = Math.abs(m[i]![col]!);
      if (v > best) {
        best = v;
        piv = i;
      }
    }
    if (best < 1e-12) return null;
    if (piv !== col) {
      const tmp = m[col]!;
      m[col] = m[piv]!;
      m[piv] = tmp;
    }
    const div = m[col]![col]!;
    for (let j = 0; j < 2 * n; j++) m[col]![j]! /= div;
    for (let i = 0; i < n; i++) {
      if (i === col) continue;
      const f = m[i]![col]!;
      if (!f) continue;
      for (let j = 0; j < 2 * n; j++) m[i]![j]! -= f * m[col]![j]!;
    }
  }
  return m.map((row) => row.slice(n));
}

export function eigenSym(A: number[][], maxIter = 80): { values: number[]; vectors: number[][] } {
  const n = A.length;
  const a = A.map((row) => row.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let iter = 0; iter < maxIter; iter++) {
    let p = 0;
    let q = 1;
    let max = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const val = Math.abs(a[i]![j]!);
        if (val > max) {
          max = val;
          p = i;
          q = j;
        }
      }
    }
    if (max < 1e-12) break;
    const app = a[p]![p]!;
    const aqq = a[q]![q]!;
    const apq = a[p]![q]!;
    const tau = (aqq - app) / (2 * apq);
    const sign = tau >= 0 ? 1 : -1;
    const t = sign / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    for (let k = 0; k < n; k++) {
      if (k === p || k === q) continue;
      const aik = a[k]![p]!;
      const aiq = a[k]![q]!;
      a[k]![p] = a[p]![k] = c * aik - s * aiq;
      a[k]![q] = a[q]![k] = s * aik + c * aiq;
    }
    a[p]![p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q]![q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p]![q] = a[q]![p] = 0;
    for (let k = 0; k < n; k++) {
      const vip = v[k]![p]!;
      const viq = v[k]![q]!;
      v[k]![p] = c * vip - s * viq;
      v[k]![q] = s * vip + c * viq;
    }
  }
  const pairs = Array.from({ length: n }, (_, i) => ({
    value: a[i]![i]!,
    vector: v.map((row) => row[i]!),
  }));
  pairs.sort((x, y) => y.value - x.value);
  return { values: pairs.map((p) => p.value), vectors: pairs.map((p) => p.vector) };
}

export function vifFromCorr(R: number[][]): (number | null)[] {
  const inv = invertMatrix(R);
  if (!inv) return R.map(() => Infinity);
  return inv.map((row, i) => {
    const d = row[i]!;
    if (!Number.isFinite(d) || d < 1) return d < 1 ? 1 : null;
    return d;
  });
}

export function kmo(R: number[][]): number {
  const p = R.length;
  if (p < 2) return NaN;
  const inv = invertMatrix(R);
  if (!inv) return NaN;
  let num = 0;
  let den = 0;
  for (let i = 0; i < p; i++) {
    for (let j = i + 1; j < p; j++) {
      const r = R[i]![j]!;
      const pij = -inv[i]![j]! / Math.sqrt(Math.max(inv[i]![i]! * inv[j]![j]!, 1e-12));
      num += r * r;
      den += r * r + pij * pij;
    }
  }
  return den ? num / den : NaN;
}

export function icc1(values: (number | null)[], entities: (string | number)[]): number {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    const k = String(entities[i]);
    const arr = groups.get(k);
    if (arr) arr.push(v);
    else groups.set(k, [v]);
  }
  const parts = [...groups.values()].filter((a) => a.length);
  const k = parts.length;
  const N = parts.reduce((a, arr) => a + arr.length, 0);
  if (k < 2 || N <= k) return NaN;
  const all = parts.flat();
  const grand = mean(all);
  let ssb = 0;
  let ssw = 0;
  for (const arr of parts) {
    const m = mean(arr);
    ssb += arr.length * (m - grand) ** 2;
    for (const x of arr) ssw += (x - m) ** 2;
  }
  const msb = ssb / (k - 1);
  const msw = ssw / (N - k);
  const sumN2 = parts.reduce((a, arr) => a + arr.length ** 2, 0);
  const n0 = (N - sumN2 / N) / (k - 1);
  const den = msb + (n0 - 1) * msw;
  if (!Number.isFinite(den) || den === 0) return NaN;
  return (msb - msw) / den;
}

export function cronbachAlpha(itemCols: number[][]): number {
  const k = itemCols.length;
  const n = itemCols[0]?.length ?? 0;
  if (k < 2 || n < 3) return NaN;
  const itemVar = itemCols.map((col) => variance(col));
  const totals = Array.from({ length: n }, (_, i) => {
    let s = 0;
    for (let j = 0; j < k; j++) s += itemCols[j]![i]!;
    return s;
  });
  const tv = variance(totals);
  const sv = itemVar.reduce((a, v) => a + v, 0);
  if (!Number.isFinite(tv) || tv === 0) return NaN;
  return (k / (k - 1)) * (1 - sv / tv);
}

export function itemTotalCorr(itemCols: number[][]): (number | null)[] {
  const k = itemCols.length;
  const n = itemCols[0]?.length ?? 0;
  if (k < 2 || n < 3) return itemCols.map(() => null);
  return itemCols.map((col, j) => {
    const rest: number[] = [];
    const self: number[] = [];
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let t = 0; t < k; t++) if (t !== j) s += itemCols[t]![i]!;
      rest.push(s);
      self.push(col[i]!);
    }
    return pearson(self, rest);
  });
}

export function alphaIfDeleted(itemCols: number[][]): number[] {
  return itemCols.map((_, j) => cronbachAlpha(itemCols.filter((_, k) => k !== j)));
}

export function listwise(cols: (number | null)[][]): { matrix: number[][]; keep: number[] } {
  const n = cols[0]?.length ?? 0;
  const p = cols.length;
  const keep: number[] = [];
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    let ok = true;
    for (let j = 0; j < p; j++) {
      const v = cols[j]![i];
      if (v == null || !Number.isFinite(v)) {
        ok = false;
        break;
      }
      row.push(v);
    }
    if (ok) {
      keep.push(i);
      matrix.push(row);
    }
  }
  return { matrix, keep };
}

export function transpose(m: number[][]): number[][] {
  const n = m.length;
  const p = m[0]?.length ?? 0;
  return Array.from({ length: p }, (_, j) => Array.from({ length: n }, (_, i) => m[i]![j]!));
}

export function imputeMean(cols: (number | null)[][]): (number | null)[][] {
  return cols.map((col) => {
    const xs = finite(col);
    const m = mean(xs);
    if (!Number.isFinite(m)) return col;
    return col.map((x) => (x == null || !Number.isFinite(x) ? m : x));
  });
}

export function normalizeWeights(w: number[]): number[] {
  const s = w.reduce((a, b) => a + b, 0);
  if (!s) return w.map(() => (w.length ? 1 / w.length : 0));
  return w.map((x) => x / s);
}

export function minmaxNorm(col: number[], direction: 1 | -1): number[] {
  const { min, max } = minMax(col);
  const span = max - min;
  if (!span) return col.map(() => 0.5);
  return col.map((x) => {
    const z = (x - min) / span;
    return direction === 1 ? z : 1 - z;
  });
}

export function zscoreNorm(col: number[], direction: 1 | -1): number[] {
  const m = mean(col);
  const s = sd(col);
  return col.map((x) => {
    const z = s ? (x - m) / s : 0;
    return direction === 1 ? z : -z;
  });
}

export function entropyWeights(normCols: number[][], rowW?: number[]): number[] {
  const p = normCols.length;
  const n = normCols[0]?.length ?? 0;
  if (!p || !n) return [];
  const k = 1 / Math.log(n);
  const d: number[] = [];
  for (let j = 0; j < p; j++) {
    const col = normCols[j]!;
    let sum = 0;
    const wcol: number[] = [];
    for (let i = 0; i < n; i++) {
      const wi = rowW ? rowW[i] ?? 0 : 1;
      const v = Math.max(col[i]!, 0) * (wi > 0 ? wi : 0);
      wcol.push(v);
      sum += v;
    }
    if (sum <= 0) {
      d.push(0);
      continue;
    }
    let e = 0;
    for (let i = 0; i < n; i++) {
      const pij = wcol[i]! / sum;
      if (pij > 0) e -= k * pij * Math.log(pij);
    }
    d.push(Math.max(0, 1 - e));
  }
  return normalizeWeights(d);
}

export function criticWeights(normCols: number[][]): number[] {
  const p = normCols.length;
  if (!p) return [];
  const sig = normCols.map((col) => sd(col) || 0);
  const R = corrMatrix(normCols);
  const c = sig.map((s, j) => {
    let conflict = 0;
    for (let k = 0; k < p; k++) {
      if (k === j) continue;
      conflict += 1 - Math.abs(R[j]![k]!);
    }
    return s * conflict;
  });
  return normalizeWeights(c);
}

export function pcaWeights(zCols: number[][]): { weights: number[]; variance: number } {
  const p = zCols.length;
  if (!p) return { weights: [], variance: NaN };
  const R = corrMatrix(zCols);
  const { values, vectors } = eigenSym(R);
  const total = values.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
  const v0 = vectors[0] ?? zCols.map(() => 1);
  const abs = v0.map((x) => Math.abs(x));
  return { weights: normalizeWeights(abs), variance: Math.max(values[0] ?? 0, 0) / total };
}

export function topsisCloseness(weighted: number[][]): number[] {
  const n = weighted.length;
  const p = weighted[0]?.length ?? 0;
  if (!n || !p) return [];
  const ideal = Array.from({ length: p }, (_, j) => Math.max(...weighted.map((r) => r[j]!)));
  const nadir = Array.from({ length: p }, (_, j) => Math.min(...weighted.map((r) => r[j]!)));
  return weighted.map((row) => {
    let dp = 0;
    let dm = 0;
    for (let j = 0; j < p; j++) {
      dp += (row[j]! - ideal[j]!) ** 2;
      dm += (row[j]! - nadir[j]!) ** 2;
    }
    dp = Math.sqrt(dp);
    dm = Math.sqrt(dm);
    const den = dp + dm;
    return den ? dm / den : 0.5;
  });
}

function ranksDesc(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const ranks = Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]!.v === idx[i]!.v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]!.i] = avg;
    i = j + 1;
  }
  return ranks;
}

export function spearman(a: number[], b: number[]): number {
  return pearson(ranksDesc(a), ranksDesc(b));
}

/** Horn parallel analysis: count eigenvalues exceeding random-data means. */
export function parallelAnalysisNf(R: number[][], nObs: number, reps = 12, seed = 7): number {
  const p = R.length;
  if (p < 2) return 1;
  const { values } = eigenSym(R);
  const rand = mulberry32(seed);
  const n = Math.min(Math.max(nObs, p + 3), 360);
  const acc = Array.from({ length: p }, () => 0);
  for (let r = 0; r < reps; r++) {
    const cols: (number | null)[][] = Array.from({ length: p }, () =>
      Array.from({ length: n }, () => gauss(rand)),
    );
    const ev = eigenSym(corrMatrix(cols)).values;
    for (let i = 0; i < p; i++) acc[i]! += ev[i] ?? 0;
  }
  let nf = 0;
  for (let i = 0; i < p; i++) {
    if (values[i]! > acc[i]! / reps && values[i]! > 0.95) nf += 1;
    else break;
  }
  return Math.max(1, Math.min(nf, p - 1));
}
