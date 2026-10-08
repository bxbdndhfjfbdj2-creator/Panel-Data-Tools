/** Analytic Hierarchy Process (Saaty) for criterion-layer weights. */

const RI = [0, 0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49, 1.51, 1.48, 1.56, 1.57, 1.59];

/** Slider step −8…8 maps onto Saaty 1/9 … 9. */
export function saatyFromStep(step: number): number {
  const s = Math.max(-8, Math.min(8, Math.round(step)));
  if (s >= 0) return s + 1;
  return 1 / (1 - s);
}

export function stepFromSaaty(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return Math.max(0, Math.min(8, Math.round(value) - 1));
  return Math.max(-8, Math.min(0, 1 - Math.round(1 / value)));
}

export function formatSaaty(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (Math.abs(value - 1) < 1e-9) return "1";
  if (value > 1) return String(Math.round(value));
  return `1/${Math.round(1 / value)}`;
}

export function identityMatrix(n: number): number[][] {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => 1));
}

export function setPair(matrix: number[][], i: number, j: number, value: number): number[][] {
  const next = matrix.map((row) => row.slice());
  const v = value > 0 ? value : 1;
  next[i]![j] = v;
  next[j]![i] = 1 / v;
  next[i]![i] = 1;
  next[j]![j] = 1;
  return next;
}

export interface AhpResult {
  weights: number[];
  lambda: number;
  ci: number;
  cr: number;
  n: number;
}

/** Geometric-mean approximation of the principal eigenvector (standard textbook method). */
export function solveAhp(matrix: number[][]): AhpResult {
  const n = matrix.length;
  if (n === 0) return { weights: [], lambda: NaN, ci: NaN, cr: NaN, n: 0 };
  if (n === 1) return { weights: [1], lambda: 1, ci: 0, cr: 0, n: 1 };

  const raw = matrix.map((row) => {
    const prod = row.reduce((a, b) => a * (b > 0 ? b : 1), 1);
    return Math.pow(prod, 1 / n);
  });
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const weights = raw.map((x) => x / sum);

  let lambda = 0;
  for (let i = 0; i < n; i++) {
    let aw = 0;
    for (let j = 0; j < n; j++) aw += matrix[i]![j]! * weights[j]!;
    lambda += aw / weights[i]!;
  }
  lambda /= n;
  const ci = n > 1 ? (lambda - n) / (n - 1) : 0;
  const ri = RI[n] ?? 1.59;
  const cr = ri === 0 ? 0 : ci / ri;
  return { weights, lambda, ci, cr, n };
}

export function consistencyLabel(cr: number): { text: string; tone: "ok" | "warn" | "danger" } {
  if (!Number.isFinite(cr)) return { text: "无法计算", tone: "danger" };
  if (cr < 0.05) return { text: "一致性很好", tone: "ok" };
  if (cr < 0.1) return { text: "一致性可接受", tone: "ok" };
  return { text: "一致性不足，请调整判断", tone: "danger" };
}
