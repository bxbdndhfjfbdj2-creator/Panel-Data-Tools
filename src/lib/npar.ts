/** Nonparametric association, scaling, trend and group tests. */
import type { CorrMethod } from "./types";
import {
  corrMatrix,
  eigenSym,
  finite,
  mean,
  pairwisePearson,
  pairwisePearsonW,
  spearman,
} from "./stats";

export type { CorrMethod };

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/** Median absolute deviation, scaled to be consistent with σ under normality. */
export function mad(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = median(xs);
  if (!Number.isFinite(m)) return NaN;
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export function robustCv(xs: number[]): number {
  const m = median(xs);
  const d = mad(xs);
  if (!Number.isFinite(m) || m === 0 || !Number.isFinite(d)) return NaN;
  return Math.abs(d / m);
}

export function trimmedMean(xs: number[], prop = 0.1): number {
  if (!xs.length) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  const k = Math.floor(a.length * prop);
  const b = k > 0 && a.length - 2 * k >= 1 ? a.slice(k, a.length - k) : a;
  return mean(b);
}

function completePair(a: (number | null)[], b: (number | null)[]): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const u = a[i];
    const v = b[i];
    if (u != null && v != null && Number.isFinite(u) && Number.isFinite(v)) {
      x.push(u);
      y.push(v);
    }
  }
  return { x, y };
}

function downsample(x: number[], y: number[], cap = 640): { x: number[]; y: number[] } {
  if (x.length <= cap) return { x, y };
  const step = Math.ceil(x.length / cap);
  const xx: number[] = [];
  const yy: number[] = [];
  for (let i = 0; i < x.length; i += step) {
    xx.push(x[i]!);
    yy.push(y[i]!);
  }
  return { x: xx, y: yy };
}

/** Kendall τ-b. O(n²); large n is strided. */
export function kendallTauB(x: number[], y: number[]): number {
  const n0 = Math.min(x.length, y.length);
  if (n0 < 3) return NaN;
  const ds = downsample(x.slice(0, n0), y.slice(0, n0));
  const n = ds.x.length;
  let C = 0;
  let D = 0;
  let Tx = 0;
  let Ty = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign(ds.x[j]! - ds.x[i]!);
      const dy = Math.sign(ds.y[j]! - ds.y[i]!);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) {
        Ty += 1;
        continue;
      }
      if (dy === 0) {
        Tx += 1;
        continue;
      }
      if (dx * dy > 0) C += 1;
      else D += 1;
    }
  }
  const den = Math.sqrt((C + D + Tx) * (C + D + Ty));
  if (!den) return NaN;
  return (C - D) / den;
}

export function pairwiseSpearman(a: (number | null)[], b: (number | null)[]): number {
  const { x, y } = completePair(a, b);
  return spearman(x, y);
}

export function pairwiseKendall(a: (number | null)[], b: (number | null)[]): number {
  const { x, y } = completePair(a, b);
  return kendallTauB(x, y);
}

export function pairwiseAssoc(
  a: (number | null)[],
  b: (number | null)[],
  method: CorrMethod,
  weights?: number[],
): number {
  if (method === "pearson") {
    return weights?.length ? pairwisePearsonW(a, b, weights) : pairwisePearson(a, b);
  }
  if (method === "spearman") return pairwiseSpearman(a, b);
  return pairwiseKendall(a, b);
}

export function assocMatrix(
  cols: (number | null)[][],
  method: CorrMethod = "pearson",
  weights?: number[],
): number[][] {
  if (method === "pearson") return corrMatrix(cols, weights);
  const p = cols.length;
  const R = Array.from({ length: p }, () => Array<number>(p).fill(1));
  for (let i = 0; i < p; i++) {
    R[i]![i] = 1;
    for (let j = i + 1; j < p; j++) {
      const r = pairwiseAssoc(cols[i]!, cols[j]!, method);
      const v = Number.isFinite(r) ? r : 0;
      R[i]![j] = v;
      R[j]![i] = v;
    }
  }
  return R;
}

export function pearsonSpearmanGap(a: (number | null)[], b: (number | null)[]): number {
  const rp = pairwisePearson(a, b);
  const rs = pairwiseSpearman(a, b);
  if (!Number.isFinite(rp) || !Number.isFinite(rs)) return NaN;
  return Math.abs(rp - rs);
}

function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

export function twoSidedP(z: number): number {
  if (!Number.isFinite(z)) return NaN;
  return Math.max(0, Math.min(1, 2 * (1 - normCdf(Math.abs(z)))));
}

/** Chi-square upper tail via Wilson–Hilferty. */
export function chi2Sf(x: number, df: number): number {
  if (!(x >= 0) || !(df > 0)) return NaN;
  if (x === 0) return 1;
  const h = 2 / (9 * df);
  const z = (Math.pow(x / df, 1 / 3) - (1 - h)) / Math.sqrt(h);
  return Math.max(0, Math.min(1, 1 - normCdf(z)));
}

function covPop(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i]! - mx) * (y[i]! - my);
  return s / n;
}

function covMax(x: number[], y: number[]): number {
  const xs = x.slice().sort((a, b) => a - b);
  const ys = y.slice().sort((a, b) => a - b);
  return covPop(xs, ys);
}

/** Loevinger's H from comonotonic covariance (Mokken). */
export function loevingerH(itemCols: number[][]): { H: number; itemH: number[] } {
  const p = itemCols.length;
  const itemNum = Array(p).fill(0);
  const itemDen = Array(p).fill(0);
  let num = 0;
  let den = 0;
  for (let i = 0; i < p; i++) {
    for (let j = i + 1; j < p; j++) {
      const c = covPop(itemCols[i]!, itemCols[j]!);
      const m = covMax(itemCols[i]!, itemCols[j]!);
      if (!(m > 0) || !Number.isFinite(c)) continue;
      num += c;
      den += m;
      itemNum[i] += c;
      itemDen[i] += m;
      itemNum[j] += c;
      itemDen[j] += m;
    }
  }
  return {
    H: den ? num / den : NaN,
    itemH: itemNum.map((v, i) => (itemDen[i] ? v / itemDen[i]! : NaN)),
  };
}

export function hLabel(H: number | null | undefined): string {
  if (H == null || !Number.isFinite(H)) return "H —";
  if (H >= 0.5) return `H ${H.toFixed(2)} 强`;
  if (H >= 0.4) return `H ${H.toFixed(2)} 中`;
  if (H >= 0.3) return `H ${H.toFixed(2)} 弱`;
  return `H ${H.toFixed(2)} 不足`;
}

/** McDonald's ω from the first factor of a correlation matrix. */
export function mcdonaldOmega(R: number[][]): number {
  if (R.length < 2) return NaN;
  const { values, vectors } = eigenSym(R);
  const ev = Math.max(values[0] ?? 0, 0);
  const load = (vectors[0] ?? []).map((x) => x * Math.sqrt(ev));
  const sl = load.reduce((s, l) => s + Math.abs(l), 0);
  const uniq = load.reduce((s, l) => s + Math.max(0, 1 - l * l), 0);
  const den = sl * sl + uniq;
  return den ? (sl * sl) / den : NaN;
}

export function standardizedAlpha(R: number[][]): number {
  const k = R.length;
  if (k < 2) return NaN;
  let s = 0;
  for (const row of R) for (const v of row) if (Number.isFinite(v)) s += v;
  if (!(s > 0)) return NaN;
  return (k / (k - 1)) * (1 - k / s);
}

export function mannKendall(values: number[]): { S: number; z: number; p: number; tau: number; n: number } {
  const x = finite(values);
  const n = x.length;
  if (n < 4) return { S: 0, z: NaN, p: NaN, tau: NaN, n };
  let S = 0;
  const ties = new Map<number, number>();
  for (const v of x) ties.set(v, (ties.get(v) ?? 0) + 1);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) S += Math.sign(x[j]! - x[i]!);
  }
  let varS = (n * (n - 1) * (2 * n + 5)) / 18;
  for (const t of ties.values()) {
    if (t > 1) varS -= (t * (t - 1) * (2 * t + 5)) / 18;
  }
  if (varS <= 0) return { S, z: 0, p: 1, tau: 0, n };
  const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const tau = S / ((n * (n - 1)) / 2);
  return { S, z, p: twoSidedP(z), tau, n };
}

export function senSlope(
  values: number[],
  times?: number[],
): { slope: number; nPairs: number } {
  const pts = values
    .map((v, i) => ({ v, t: times?.[i] ?? i }))
    .filter((o) => Number.isFinite(o.v) && Number.isFinite(o.t))
    .sort((a, b) => a.t - b.t);
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dt = pts[j]!.t - pts[i]!.t;
      if (dt === 0) continue;
      slopes.push((pts[j]!.v - pts[i]!.v) / dt);
    }
  }
  return { slope: median(slopes), nPairs: slopes.length };
}

export function mannKendallSen(
  values: number[],
  times?: number[],
): { S: number; z: number; p: number; tau: number; slope: number; n: number } {
  const pts = values
    .map((v, i) => ({ v, t: times?.[i] ?? i }))
    .filter((o) => Number.isFinite(o.v) && Number.isFinite(o.t))
    .sort((a, b) => a.t - b.t);
  const mk = mannKendall(pts.map((p) => p.v));
  const sen = senSlope(
    pts.map((p) => p.v),
    pts.map((p) => p.t),
  );
  return { ...mk, slope: sen.slope };
}

/** Kendall's W of concordance. rankRows[rater][object] = rank (1 = best). */
export function kendallW(rankRows: number[][]): { W: number; chi2: number; p: number; m: number; n: number } {
  const m = rankRows.length;
  const n = rankRows[0]?.length ?? 0;
  const fail = { W: NaN, chi2: NaN, p: NaN, m, n };
  if (m < 2 || n < 3) return fail;
  const R = Array(n).fill(0);
  for (const row of rankRows) {
    if (row.length !== n) return fail;
    for (let i = 0; i < n; i++) R[i] += row[i]!;
  }
  const meanR = (m * (n + 1)) / 2;
  let S = 0;
  for (const r of R) S += (r - meanR) ** 2;
  let T = 0;
  for (const row of rankRows) {
    const g = new Map<number, number>();
    for (const v of row) g.set(v, (g.get(v) ?? 0) + 1);
    for (const t of g.values()) if (t > 1) T += t ** 3 - t;
  }
  const den = m * m * (n ** 3 - n) - m * T;
  const W = den ? (12 * S) / den : NaN;
  const chi2 = m * (n - 1) * W;
  return { W, chi2, p: chi2Sf(chi2, n - 1), m, n };
}

export function kruskalWallis(groups: number[][]): { H: number; p: number; k: number; n: number } {
  const gs = groups.map((g) => finite(g)).filter((g) => g.length);
  const k = gs.length;
  const all: { v: number; g: number }[] = [];
  gs.forEach((g, gi) => g.forEach((v) => all.push({ v, g: gi })));
  const n = all.length;
  const fail = { H: NaN, p: NaN, k, n };
  if (k < 2 || n < 6) return fail;
  all.sort((a, b) => a.v - b.v);
  const ranks = Array(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && all[j + 1]!.v === all[i]!.v) j++;
    const avg = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) ranks[t] = avg;
    i = j + 1;
  }
  const R = Array(k).fill(0);
  const nj = Array(k).fill(0);
  all.forEach((row, t) => {
    R[row.g] += ranks[t]!;
    nj[row.g] += 1;
  });
  let H = 0;
  for (let g = 0; g < k; g++) H += (R[g]! * R[g]!) / nj[g]!;
  H = (12 / (n * (n + 1))) * H - 3 * (n + 1);
  let tie = 0;
  i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && all[j + 1]!.v === all[i]!.v) j++;
    const t = j - i + 1;
    if (t > 1) tie += t ** 3 - t;
    i = j + 1;
  }
  const corr = 1 - tie / (n ** 3 - n);
  if (corr > 0) H /= corr;
  return { H, p: chi2Sf(H, k - 1), k, n };
}

export function mannWhitney(a: number[], b: number[]): { U: number; z: number; p: number; n1: number; n2: number } {
  const x = finite(a);
  const y = finite(b);
  const n1 = x.length;
  const n2 = y.length;
  let u = 0;
  for (const va of x) {
    for (const vb of y) {
      if (va > vb) u += 1;
      else if (va === vb) u += 0.5;
    }
  }
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = sigma ? (u - mu) / sigma : NaN;
  return { U: u, z, p: twoSidedP(z), n1, n2 };
}

export const CORR_METHOD_LABEL: Record<CorrMethod, string> = {
  pearson: "Pearson",
  spearman: "Spearman",
  kendall: "Kendall τ",
};
