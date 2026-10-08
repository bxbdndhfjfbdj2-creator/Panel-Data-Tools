import type { LogMode, TransformSpec } from "./types";
import { finite } from "./stats";

export function quantile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  if (p <= 0) return s[0]!;
  if (p >= 1) return s[s.length - 1]!;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return s[lo]!;
  const t = i - lo;
  return s[lo]! * (1 - t) + s[hi]! * t;
}

export function winsorize(col: (number | null)[], tail: number): (number | null)[] {
  if (tail <= 0) return col;
  const xs = finite(col);
  if (xs.length < 8) return col;
  const lo = quantile(xs, tail);
  const hi = quantile(xs, 1 - tail);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return col;
  return col.map((x) => (x == null ? null : x < lo ? lo : x > hi ? hi : x));
}

function logCol(col: (number | null)[], mode: LogMode): { col: (number | null)[]; skipped: boolean } {
  if (mode === "off") return { col, skipped: false };
  const xs = finite(col);
  if (!xs.length) return { col, skipped: true };
  const mapped = col.map((x) => {
    if (x == null) return null;
    if (mode === "ln") return x > 0 ? Math.log(x) : null;
    return x >= 0 ? Math.log1p(x) : null;
  });
  const keep = mapped.filter((x) => x != null).length;
  if (keep / xs.length < 0.7) return { col, skipped: true };
  return { col: mapped, skipped: false };
}

export function applyTransform(
  col: (number | null)[],
  spec: TransformSpec,
): { col: (number | null)[]; skippedLog: boolean } {
  const w = spec.winsor > 0 ? winsorize(col, spec.winsor) : col;
  const r = logCol(w, spec.logMode);
  return { col: r.col, skippedLog: r.skipped };
}

export function applyTransformColumns(
  cols: (number | null)[][],
  spec: TransformSpec,
): { cols: (number | null)[][]; skippedLog: string[] } {
  const skippedLog: string[] = [];
  const out = cols.map((col, j) => {
    const r = applyTransform(col, spec);
    if (r.skippedLog) skippedLog.push(String(j));
    return r.col;
  });
  return { cols: out, skippedLog };
}

export function samplingWeights(rows: { [k: string]: string | number | null }[], key?: string): number[] {
  if (!key) return rows.map(() => 1);
  return rows.map((r) => {
    const v = r[key];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  });
}

export function weightedMean(xs: (number | null)[], w: number[]): number {
  let num = 0;
  let den = 0;
  const n = Math.min(xs.length, w.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const wi = w[i]!;
    if (x == null || !wi) continue;
    num += x * wi;
    den += wi;
  }
  return den ? num / den : NaN;
}

export function weightedSd(xs: (number | null)[], w: number[]): number {
  const m = weightedMean(xs, w);
  if (!Number.isFinite(m)) return NaN;
  let num = 0;
  let den = 0;
  const n = Math.min(xs.length, w.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const wi = w[i]!;
    if (x == null || !wi) continue;
    num += wi * (x - m) ** 2;
    den += wi;
  }
  return den ? Math.sqrt(num / den) : NaN;
}

export function effectiveN(w: number[]): number {
  let s = 0;
  let s2 = 0;
  for (const x of w) {
    if (!x) continue;
    s += x;
    s2 += x * x;
  }
  return s2 ? (s * s) / s2 : 0;
}
