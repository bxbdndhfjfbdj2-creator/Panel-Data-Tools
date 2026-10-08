import type { Dataset, MeasureKind, MissingMode, Standardize, TransformSpec, WeightTable } from "./types";
import { DEFAULT_TRANSFORM } from "./types";
import {
  colValues,
  corrMatrix,
  cronbachAlpha,
  eigenSym,
  finite,
  kmo,
  listwise,
  mean,
  pairwisePearson,
  skewness,
  spearman,
  transpose,
} from "./stats";
import { applyTransform } from "./transform";
import { computeScores, latestByEntity, rankForYear } from "./engine";
import { mulberry32 } from "./prng";

function recode(col: (number | null)[], dir: 1 | -1): (number | null)[] {
  if (dir === 1) return col;
  return col.map((x) => (x == null || !Number.isFinite(x) ? x : -x));
}

function isLikert(xs: number[]): boolean {
  return xs.length > 0 && xs.every((x) => Number.isInteger(x) && x >= 1 && x <= 7);
}

export interface ScaleHint {
  key: string;
  name: string;
  skew: number;
  likert: boolean;
  suggestDir: 1 | -1;
  currentDir: 1 | -1;
  suggestLog: boolean;
  note: string;
}

export function scaleHints(ds: Dataset, tx: TransformSpec = DEFAULT_TRANSFORM): ScaleHint[] {
  const items = ds.indicators.filter((i) => i.selected);
  if (items.length < 2) return [];
  const cols = items.map((i) => recode(applyTransform(colValues(ds.rows, i.key), tx).col, i.direction));
  return items.map((ind, j) => {
    const xs = finite(cols[j]!);
    const skew = skewness(xs);
    const likert = isLikert(xs);
    const restMean: (number | null)[] = ds.rows.map((_, i) => {
      let s = 0;
      let n = 0;
      cols.forEach((c, t) => {
        if (t === j) return;
        const v = c[i];
        if (v != null) {
          s += v;
          n += 1;
        }
      });
      return n ? s / n : null;
    });
    const r = pairwisePearson(cols[j]!, restMean);
    let suggestDir = ind.direction;
    let note = "";
    if (Number.isFinite(r) && r < -0.25) {
      suggestDir = ind.direction === 1 ? -1 : 1;
      note = "与其余纳入指标负相关，建议取反。";
    }
    const raw = finite(colValues(ds.rows, ind.key));
    const min = raw.length ? Math.min(...raw) : NaN;
    const suggestLog = !likert && raw.length > 8 && min >= 0 && Number.isFinite(skew) && skew > 1.2;
    if (suggestLog) note = note ? `${note} 右偏，聚合步建议 ln(1+x)。` : "右偏，聚合步建议 ln(1+x)。";
    if (!note) note = likert ? "李克特题，勿取对数。" : "方向与量纲可接受。";
    return {
      key: ind.key,
      name: ind.name,
      skew,
      likert,
      suggestDir,
      currentDir: ind.direction,
      suggestLog,
      note,
    };
  });
}

export interface DimFit {
  id: string;
  name: string;
  measure: MeasureKind;
  n: number;
  alpha: number | null;
  kmo: number | null;
  ave: number | null;
  cr: number | null;
}

export interface ConstructFit {
  dims: DimFit[];
  between: { a: string; b: string; r: number }[];
  notes: string[];
}

export function constructFit(ds: Dataset, tx: TransformSpec = DEFAULT_TRANSFORM): ConstructFit {
  const notes: string[] = [];
  const dims: DimFit[] = [];
  const dimMeans: { id: string; col: (number | null)[] }[] = [];
  for (const dim of ds.dimensions) {
    const members = ds.indicators.filter((i) => i.selected && i.dimensionId === dim.id);
    const measure: MeasureKind =
      dim.measure ?? (ds.kind === "survey" ? "reflective" : "formative");
    if (members.length < 2) {
      dims.push({ id: dim.id, name: dim.name, measure, n: members.length, alpha: null, kmo: null, ave: null, cr: null });
      continue;
    }
    const cols = members.map((m) => recode(applyTransform(colValues(ds.rows, m.key), tx).col, m.direction));
    const { matrix, keep } = listwise(cols);
    let alpha: number | null = null;
    let kmoVal: number | null = null;
    let ave: number | null = null;
    let cr: number | null = null;
    if (keep.length >= 8 && matrix.length) {
      const itemCols = transpose(matrix);
      const a = cronbachAlpha(itemCols);
      if (Number.isFinite(a)) alpha = a;
      const R = corrMatrix(itemCols);
      const km = kmo(R);
      if (Number.isFinite(km)) kmoVal = km;
      const { values, vectors } = eigenSym(R);
      const ev = Math.max(values[0] ?? 0, 0);
      const loadings = (vectors[0] ?? []).map((x) => x * Math.sqrt(ev));
      if (loadings.length) {
        const sq = loadings.map((l) => l * l);
        ave = mean(sq);
        const sl = loadings.reduce((s, l) => s + Math.abs(l), 0);
        const uniq = sq.reduce((s, x) => s + Math.max(0, 1 - x), 0);
        cr = sl * sl / (sl * sl + uniq);
      }
    }
    dims.push({ id: dim.id, name: dim.name, measure, n: members.length, alpha, kmo: kmoVal, ave, cr });
    const col: (number | null)[] = ds.rows.map((_, i) => {
      let s = 0;
      let n = 0;
      for (const c of cols) {
        const v = c[i];
        if (v != null) {
          s += v;
          n += 1;
        }
      }
      return n ? s / n : null;
    });
    dimMeans.push({ id: dim.id, col });
    if (measure === "formative" && alpha != null && alpha < 0.6) {
      notes.push(`${dim.name} 为形成性维度，α 仅作参考。`);
    }
  }
  const between: ConstructFit["between"] = [];
  for (let i = 0; i < dimMeans.length; i++) {
    for (let j = i + 1; j < dimMeans.length; j++) {
      const r = pairwisePearson(dimMeans[i]!.col, dimMeans[j]!.col);
      if (Number.isFinite(r)) between.push({ a: dimMeans[i]!.id, b: dimMeans[j]!.id, r });
    }
  }
  return { dims, between, notes };
}

export interface YearStability {
  years: number[];
  rho: { year: number; rho: number; n: number }[];
  meanRho: number | null;
}

export function yearStability(
  ds: Dataset,
  weights: WeightTable,
  standardize: Standardize,
  method: WeightTable["method"],
  missing: MissingMode,
  tx: TransformSpec = DEFAULT_TRANSFORM,
): YearStability | null {
  if (!ds.timeKey) return null;
  const years = [...new Set(ds.rows.map((r) => Number(r[ds.timeKey!])).filter((y) => Number.isFinite(y)))].sort(
    (a, b) => a - b,
  );
  if (years.length < 2) return null;
  const latest = years[years.length - 1]!;
  const full = computeScores(ds, weights, standardize, method, missing, tx);
  const base = rankForYear(full.rows, latest);
  const baseMap = new Map(base.map((r) => [r.entity, r.composite]));
  const rho: YearStability["rho"] = [];
  for (const y of years) {
    if (y === latest) continue;
    const ranked = rankForYear(full.rows, y);
    const entities = ranked.map((r) => r.entity).filter((e) => baseMap.has(e));
    if (entities.length < 5) continue;
    const a = entities.map((e) => ranked.find((r) => r.entity === e)!.composite);
    const b = entities.map((e) => baseMap.get(e)!);
    rho.push({ year: y, rho: spearman(a, b), n: entities.length });
  }
  const meanRho = rho.length ? mean(rho.map((x) => x.rho).filter((x) => Number.isFinite(x))) : null;
  return { years, rho, meanRho };
}

export function bootstrapIntervals(
  ds: Dataset,
  weights: WeightTable,
  standardize: Standardize,
  method: WeightTable["method"],
  missing: MissingMode,
  tx: TransformSpec,
  entities: string[],
  B = 36,
): Record<string, { lo: number; hi: number }> {
  const out: Record<string, { lo: number; hi: number }> = {};
  if (entities.length < 6 || ds.rows.length > 3500) return out;
  const rand = mulberry32(2026);
  const n = ds.rows.length;
  const bags: Record<string, number[]> = {};
  for (const e of entities) bags[e] = [];
  const panel = ds.kind === "panel";
  const byEnt = new Map<string, number[]>();
  if (panel) {
    ds.rows.forEach((r, i) => {
      const e = String(r[ds.entityKey] ?? "");
      const arr = byEnt.get(e);
      if (arr) arr.push(i);
      else byEnt.set(e, [i]);
    });
  }
  const entKeys = [...byEnt.keys()];
  for (let b = 0; b < B; b++) {
    const idx: number[] = [];
    if (panel && entKeys.length) {
      for (let i = 0; i < entKeys.length; i++) {
        const pick = entKeys[Math.floor(rand() * entKeys.length)]!;
        idx.push(...(byEnt.get(pick) ?? []));
      }
    } else {
      for (let i = 0; i < n; i++) idx.push(Math.floor(rand() * n));
    }
    const boot: Dataset = { ...ds, rows: idx.map((i) => ds.rows[i]!) };
    const scored = computeScores(boot, weights, standardize, method, missing, tx);
    const ranked = panel ? latestByEntity(scored.rows) : scored.rows;
    const map = new Map(ranked.map((r) => [r.entity, r.composite]));
    for (const e of entities) {
      const v = map.get(e);
      if (v != null) bags[e]!.push(v);
    }
  }
  for (const e of entities) {
    const xs = (bags[e] ?? []).sort((a, b) => a - b);
    if (xs.length < 8) continue;
    const lo = xs[Math.floor(0.025 * (xs.length - 1))]!;
    const hi = xs[Math.ceil(0.975 * (xs.length - 1))]!;
    out[e] = { lo, hi };
  }
  return out;
}
