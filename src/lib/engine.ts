import type {
  AggMethod,
  CorrMethod,
  Dataset,
  MeasureKind,
  MissingMode,
  ScreenRow,
  ScreeningThresholds,
  ScoreRow,
  Standardize,
  TransformSpec,
  WeightTable,
} from "./types";
import { DEFAULT_TRANSFORM, FLAG_LABEL } from "./types";
import {
  alphaIfDeleted,
  colValues,
  corrMatrix,
  criticWeights,
  cronbachAlpha,
  entropyWeights,
  finite,
  icc1,
  imputeMean,
  itemTotalCorr,
  kmo,
  listwise,
  mean,
  minMax,
  minmaxNorm,
  pcaWeights,
  sd,
  skewness,
  spearman,
  topsisCloseness,
  transpose,
  vifFromCorr,
  zscoreNorm,
  normalizeWeights,
} from "./stats";
import {
  applyTransform,
  samplingWeights,
  weightedMean,
  weightedSd,
} from "./transform";
import {
  assocMatrix,
  mad as madStat,
  pearsonSpearmanGap,
  robustCv,
} from "./npar";

function preparedCols(ds: Dataset, keys: string[], tx: TransformSpec) {
  const skipped: string[] = [];
  const cols = keys.map((k) => {
    const r = applyTransform(colValues(ds.rows, k), tx);
    if (r.skippedLog) skipped.push(k);
    return r.col;
  });
  return { cols, skipped };
}

function transformNotes(tx: TransformSpec, skipped: string[], names: Record<string, string>): string[] {
  const notes: string[] = [];
  if (tx.winsor > 0) {
    const p = Math.round(tx.winsor * 100);
    notes.push(`已按 ${p}% / ${100 - p}% 分位缩尾。`);
  }
  if (tx.logMode === "ln") notes.push("正值指标取 ln；非正视为缺失。");
  if (tx.logMode === "log1p") notes.push("非负指标取 ln(1+x)；负值视为缺失。");
  if (skipped.length) {
    notes.push(
      `以下指标因非正过多已跳过对数：${skipped.map((k) => names[k] ?? k).join("、")}。`,
    );
  }
  return notes;
}

export function screenDataset(
  ds: Dataset,
  th: ScreeningThresholds,
  tx: TransformSpec = DEFAULT_TRANSFORM,
  corrMethod: CorrMethod = "pearson",
): ScreenRow[] {
  const keys = ds.indicators.map((i) => i.key);
  const { cols } = preparedCols(ds, keys, tx);
  const names = Object.fromEntries(ds.indicators.map((i) => [i.key, i.name]));
  const sw = samplingWeights(ds.rows, ds.weightKey);
  const hasW = Boolean(ds.weightKey);
  const wide = keys.length > 48;
  const method = corrMethod === "kendall" && ds.rows.length > 800 ? "spearman" : corrMethod;
  const R = wide
    ? keys.map((_, i) => keys.map((__, j) => (i === j ? 1 : 0)))
    : assocMatrix(cols, method, hasW && method === "pearson" ? sw : undefined);
  const vifs: (number | null)[] = wide ? keys.map(() => null) : vifFromCorr(R);

  const dimOf = new Map(ds.indicators.map((i) => [i.key, i.dimensionId] as const));
  const measureOf = (dimId: string | null): MeasureKind | null => {
    if (!dimId) return null;
    return (
      ds.dimensions.find((d) => d.id === dimId)?.measure ??
      (ds.kind === "survey" ? "reflective" : "formative")
    );
  };
  if (!wide) {
    for (const dim of ds.dimensions) {
      const idxs = keys.map((_, i) => i).filter((i) => dimOf.get(keys[i]!) === dim.id);
      if (idxs.length < 3) continue;
      const sub = idxs.map((i) => idxs.map((j) => R[i]![j]!));
      const vv = vifFromCorr(sub);
      idxs.forEach((i, t) => {
        vifs[i] = vv[t] ?? null;
      });
    }
  }

  const scored = cols.map((col, j) => recodeForDirection(col, ds.indicators[j]!.direction));
  const alignedAll = completeCases(scored);
  const itemTotals: (number | null)[] = keys.map(() => null);
  const alphaDeleted: (number | null)[] = keys.map(() => null);
  const alphaRef: (number | null)[] = keys.map(() => null);
  let overallAlpha: number | null = null;

  if (ds.kind === "survey") {
    if (alignedAll && alignedAll.cols.length >= 2) {
      const a = cronbachAlpha(alignedAll.cols);
      if (Number.isFinite(a)) overallAlpha = a;
    }
    const groups = new Map<string, number[]>();
    ds.indicators.forEach((ind, j) => {
      const nInDim = ind.dimensionId
        ? ds.indicators.filter((x) => x.dimensionId === ind.dimensionId).length
        : 0;
      const g = nInDim >= 2 ? ind.dimensionId! : "__all__";
      const arr = groups.get(g);
      if (arr) arr.push(j);
      else groups.set(g, [j]);
    });
    for (const idxs of groups.values()) {
      if (idxs.length < 2) continue;
      const sub = idxs.map((j) => scored[j]!);
      const aligned = completeCases(sub);
      if (!aligned || aligned.cols.length < 2) continue;
      const it = itemTotalCorr(aligned.cols);
      const a = cronbachAlpha(aligned.cols);
      const ad = idxs.length >= 3 ? alphaIfDeleted(aligned.cols) : null;
      idxs.forEach((j, t) => {
        const v = it[t];
        itemTotals[j] = v != null && Number.isFinite(v) ? v : null;
        alphaRef[j] = Number.isFinite(a) ? a : null;
        if (ad) {
          const d = ad[t];
          alphaDeleted[j] = d != null && Number.isFinite(d) ? d : null;
        }
      });
    }
  }

  const entities = ds.rows.map((r) => String(r[ds.entityKey] ?? ""));

  const rows = ds.indicators.map((ind, j) => {
    const raw = cols[j]!;
    const xs = finite(raw);
    const n = raw.length;
    const missing = n ? 1 - xs.length / n : 1;
    const m = hasW ? weightedMean(raw, sw) : mean(xs);
    const s = hasW ? weightedSd(raw, sw) : sd(xs);
    const { min, max } = xs.length ? minMax(xs) : { min: NaN, max: NaN };
    const ratioScale = xs.length > 0 && min >= 0 && Number.isFinite(m) && m !== 0;
    const cv = ratioScale && Number.isFinite(s) ? Math.abs(s / m) : NaN;
    const md = madStat(xs);
    const rcv = ratioScale && xs.length > 2 && min >= 0 ? robustCv(xs) : NaN;
    const skew = skewness(xs);
    const vif = vifs[j] ?? null;

    let maxCorr: ScreenRow["maxCorr"] = null;
    let best = 0;
    for (let k = 0; k < keys.length; k++) {
      if (k === j) continue;
      const r = R[j]![k]!;
      if (Number.isFinite(r) && Math.abs(r) > Math.abs(best)) {
        best = r;
        maxCorr = { key: keys[k]!, name: names[keys[k]!] ?? keys[k]!, r };
      }
    }

    const itemTotal = itemTotals[j];
    const bounds = likertBounds(xs);
    const floor = xs.length
      ? xs.filter((x) => x === (bounds?.lo ?? min)).length / xs.length
      : null;
    const ceiling = xs.length
      ? xs.filter((x) => x === (bounds?.hi ?? max)).length / xs.length
      : null;
    const icc = ds.kind === "panel" ? icc1(raw, entities) : null;
    const aDel = alphaDeleted[j];
    const aBase = alphaRef[j] ?? overallAlpha;
    const gapRS =
      maxCorr && !wide ? pearsonSpearmanGap(raw, cols[keys.indexOf(maxCorr.key)]!) : NaN;

    const flags: ScreenRow["flags"] = [];
    if (!xs.length || s === 0 || !Number.isFinite(s)) flags.push("constant");
    if (missing > th.maxMissing) flags.push("missing");
    if (Number.isFinite(cv) && cv < th.minCv && s !== 0) flags.push("low_cv");
    if (Number.isFinite(gapRS) && gapRS > 0.2) flags.push("nonlinear");
    const meas = measureOf(ind.dimensionId);
    if (meas !== "reflective" && vif != null && vif > th.maxVif) flags.push("high_vif");
    if (ds.kind === "survey" && itemTotal != null && itemTotal < th.minItemTotal) {
      flags.push("low_item_total");
    }
    if (ds.kind === "survey" && floor != null && floor > th.maxFloorCeiling) flags.push("floor");
    if (ds.kind === "survey" && ceiling != null && ceiling > th.maxFloorCeiling) {
      flags.push("ceiling");
    }
    if (
      ds.kind === "survey" &&
      aDel != null &&
      aBase != null &&
      Number.isFinite(aDel) &&
      Number.isFinite(aBase) &&
      aDel > aBase + 0.01
    ) {
      flags.push("hurts_alpha");
    }

    return {
      key: ind.key,
      name: ind.name,
      n: xs.length,
      missing,
      mean: m,
      sd: s,
      cv,
      min,
      max,
      skew,
      vif,
      maxCorr,
      itemTotal: itemTotal != null && Number.isFinite(itemTotal) ? itemTotal : null,
      floor,
      ceiling,
      icc: icc != null && Number.isFinite(icc) ? icc : null,
      alphaIfDeleted: aDel != null && Number.isFinite(aDel) ? aDel : null,
      mad: md,
      rcv,
      gapRS: Number.isFinite(gapRS) ? gapRS : null,
      flags,
      pass: flags.length === 0,
    };
  });

  const corrDrop = new Set<string>();
  const withinDrop = new Set<string>();
  const betweenHit = new Set<string>();
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const r = R[i]![j]!;
      if (!Number.isFinite(r) || Math.abs(r) <= th.maxAbsCorr) continue;
      const di = dimOf.get(keys[i]!) ?? null;
      const dj = dimOf.get(keys[j]!) ?? null;
      const worse =
        (vifs[i] ?? -Infinity) === (vifs[j] ?? -Infinity)
          ? j
          : (vifs[i] ?? -Infinity) > (vifs[j] ?? -Infinity)
            ? i
            : j;
      if (di && dj && di === dj) {
        if (measureOf(di) === "reflective") continue;
        withinDrop.add(keys[worse]!);
        continue;
      }
      if (di && dj && di !== dj) {
        betweenHit.add(keys[i]!);
        betweenHit.add(keys[j]!);
        continue;
      }
      corrDrop.add(keys[worse]!);
    }
  }
  for (const row of rows) {
    if (corrDrop.has(row.key) && !row.flags.includes("high_corr")) row.flags.push("high_corr");
    if (withinDrop.has(row.key) && !row.flags.includes("within_redundant")) {
      row.flags.push("within_redundant");
    }
    if (betweenHit.has(row.key) && !row.flags.includes("between_corr")) {
      row.flags.push("between_corr");
    }
    row.pass = row.flags.filter((f) => f !== "between_corr" && f !== "nonlinear").length === 0;
  }
  return rows;
}

export function indicatorCorr(ds: Dataset, keys?: string[]) {
  const use = keys ?? ds.indicators.map((i) => i.key);
  const cols = use.map((k) => colValues(ds.rows, k));
  return {
    keys: use,
    names: use.map((k) => ds.indicators.find((i) => i.key === k)?.name ?? k),
    R: corrMatrix(cols),
  };
}

function recodeForDirection(col: (number | null)[], direction: 1 | -1): (number | null)[] {
  if (direction === 1) return col;
  return col.map((x) => (x == null || !Number.isFinite(x) ? x : -x));
}

/** Likert-like integers on 1–5 or 1–7; otherwise floor/ceiling use observed min/max. */
function likertBounds(xs: number[]): { lo: number; hi: number } | null {
  if (!xs.length) return null;
  if (!xs.every((x) => Number.isInteger(x) && x >= 1 && x <= 7)) return null;
  return { lo: 1, hi: Math.max(...xs) <= 5 ? 5 : 7 };
}

function completeCases(cols: (number | null)[][]): { cols: number[][]; keep: number[] } | null {
  const { matrix, keep } = listwise(cols);
  if (!matrix.length) return null;
  return { cols: transpose(matrix), keep };
}

function alignCols(
  cols: (number | null)[][],
  missing: MissingMode,
): { cols: number[][]; keep: number[] } | null {
  const filled = missing === "listwise" ? cols : imputeMean(cols);
  return completeCases(filled);
}

function scaleNullable(
  col: (number | null)[],
  direction: 1 | -1,
  standardize: Standardize,
): (number | null)[] {
  const xs = finite(col);
  if (!xs.length) return col.map(() => null);
  if (standardize === "zscore") {
    const m = mean(xs);
    const s = sd(xs);
    return col.map((x) => {
      if (x == null) return null;
      if (!s) return 0;
      const z = (x - m) / s;
      return direction === 1 ? z : -z;
    });
  }
  const { min, max } = minMax(xs);
  const span = max - min;
  return col.map((x) => {
    if (x == null) return null;
    if (!span) return 0.5;
    const z = (x - min) / span;
    return direction === 1 ? z : 1 - z;
  });
}

export function reliability(ds: Dataset): { overall: number | null; byDim: Record<string, number> } {
  const byDim: Record<string, number> = {};
  if (ds.kind !== "survey") return { overall: null, byDim };
  for (const dim of ds.dimensions) {
    const members = ds.indicators.filter((i) => i.selected && i.dimensionId === dim.id);
    if (members.length < 2) continue;
    const cols = members.map((m) => recodeForDirection(colValues(ds.rows, m.key), m.direction));
    const aligned = completeCases(cols);
    if (!aligned || aligned.keep.length < 8) continue;
    const a = cronbachAlpha(aligned.cols);
    if (Number.isFinite(a)) byDim[dim.id] = a;
  }
  const all = ds.indicators.filter((i) => i.selected);
  let overall: number | null = null;
  if (all.length >= 2) {
    const cols = all.map((m) => recodeForDirection(colValues(ds.rows, m.key), m.direction));
    const aligned = completeCases(cols);
    if (aligned && aligned.keep.length >= 8) {
      const a = cronbachAlpha(aligned.cols);
      if (Number.isFinite(a)) overall = a;
    }
  }
  return { overall, byDim };
}

export function computeWeights(
  ds: Dataset,
  method: AggMethod,
  missing: MissingMode = "listwise",
  tx: TransformSpec = DEFAULT_TRANSFORM,
): WeightTable {
  const notes: string[] = [];
  const dimW: Record<string, number> = {};
  for (const d of ds.dimensions) {
    const has = ds.indicators.some((i) => i.selected && i.dimensionId === d.id);
    dimW[d.id] = has ? d.weight : 0;
  }
  if (Object.values(dimW).some((w) => w === 0)) {
    notes.push("无纳入指标的维度已从合成中剔除，其余维度权重已重新归一。");
  }
  const dimNorm = normalizeRecord(dimW);
  const names = Object.fromEntries(ds.indicators.map((i) => [i.key, i.name]));
  const sw = samplingWeights(ds.rows, ds.weightKey);

  const indicator: Record<string, number> = {};
  let pcaVariance: number | undefined;
  const skippedLog: string[] = [];

  for (const dim of ds.dimensions) {
    const members = ds.indicators.filter((i) => i.selected && i.dimensionId === dim.id);
    if (!members.length) continue;
    if (method === "equal" || method === "median" || method === "trimmed") {
      const w = 1 / members.length;
      for (const m of members) indicator[m.key] = w;
      continue;
    }
    if (method === "custom") {
      const raw = members.map((m) => m.weight);
      const nw = normalizeWeights(raw);
      members.forEach((m, i) => {
        indicator[m.key] = nw[i]!;
      });
      continue;
    }
    if (method === "cv") {
      const cvs = members.map((m) => {
        const r = applyTransform(colValues(ds.rows, m.key), tx);
        if (r.skippedLog) skippedLog.push(m.key);
        const mu = ds.weightKey ? weightedMean(r.col, sw) : mean(finite(r.col));
        const s = ds.weightKey ? weightedSd(r.col, sw) : sd(finite(r.col));
        return mu !== 0 && Number.isFinite(mu) && Number.isFinite(s) ? Math.abs(s / mu) : 0;
      });
      const nw = normalizeWeights(cvs);
      members.forEach((m, i) => {
        indicator[m.key] = nw[i]!;
      });
      continue;
    }

    const prepared = preparedCols(
      ds,
      members.map((m) => m.key),
      tx,
    );
    skippedLog.push(...prepared.skipped);
    const aligned = alignCols(prepared.cols, missing);
    if (!aligned || aligned.keep.length < 4) {
      notes.push(`${dim.name} 有效样本不足，回退等权。`);
      const w = 1 / members.length;
      for (const m of members) indicator[m.key] = w;
      continue;
    }

    const dirs = members.map((m) => m.direction);
    const normCols = aligned.cols.map((col, j) => minmaxNorm(col, dirs[j]!));
    const rowW = ds.weightKey ? aligned.keep.map((i) => sw[i] ?? 0) : undefined;

    let w: number[] = [];
    if (method === "entropy" || method === "topsis") {
      w = entropyWeights(normCols, rowW);
    } else if (method === "critic") {
      w = criticWeights(normCols);
    } else if (method === "pca") {
      const zCols = aligned.cols.map((col, j) => zscoreNorm(col, dirs[j]!));
      const pca = pcaWeights(zCols);
      w = pca.weights;
      if (pcaVariance == null) pcaVariance = pca.variance;
      else pcaVariance = (pcaVariance + pca.variance) / 2;
    }
    members.forEach((m, i) => {
      indicator[m.key] = w[i] ?? 1 / members.length;
    });
  }

  if (method === "pca" && pcaVariance != null) {
    notes.push(`各维度第一主成分平均解释方差 ${Math.round(pcaVariance * 1000) / 10}%。`);
  }
  if (missing === "mean") {
    notes.push("缺失值按列均值填补后再进入赋权与合成。");
  }
  if (missing === "pairwise") {
    notes.push("赋权阶段按列均值填补；合成时只对每行已观测指标重标权重。");
  }
  if (ds.weightKey) {
    notes.push("熵权与变异系数使用抽样权重；相关、CRITIC 冲突项与主成分仍为未加权。");
  }
  notes.push(...transformNotes(tx, [...new Set(skippedLog)], names));

  return { method, indicator, dimension: dimNorm, pcaVariance, notes };
}

function normalizeRecord(w: Record<string, number>): Record<string, number> {
  const keys = Object.keys(w);
  const s = keys.reduce((a, k) => a + (w[k] ?? 0), 0);
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = s ? (w[k] ?? 0) / s : 1 / keys.length;
  return out;
}

export interface ScoreBundle {
  rows: ScoreRow[];
  dropped: number;
  kmo: number | null;
  method: AggMethod;
}

function scoreAvailable(
  ds: Dataset,
  selected: Dataset["indicators"],
  keys: string[],
  cols: (number | null)[][],
  dirs: (1 | -1)[],
  weights: WeightTable,
  standardize: Standardize,
  method: AggMethod,
  kmoVal: number | null,
): ScoreBundle {
  const nRows = ds.rows.length;
  const minObs = Math.max(1, Math.ceil(keys.length / 2));
  const norm = cols.map((col, j) => scaleNullable(col, dirs[j]!, standardize));
  const sw = samplingWeights(ds.rows, ds.weightKey);
  const dimMembers: Record<string, string[]> = {};
  for (const ind of selected) {
    (dimMembers[ind.dimensionId!] ??= []).push(ind.key);
  }

  const keep: number[] = [];
  const composite: number[] = [];
  const dimScores: Record<string, number[]> = {};
  const zList: Record<string, number>[] = [];
  for (const dim of ds.dimensions) dimScores[dim.id] = [];

  for (let i = 0; i < nRows; i++) {
    const z: Record<string, number> = {};
    let obs = 0;
    keys.forEach((k, j) => {
      const v = norm[j]![i];
      if (v != null) {
        z[k] = v;
        obs += 1;
      }
    });
    if (obs < minObs) continue;

    const dims: Record<string, number> = {};
    let dimWsum = 0;
    let comp = 0;
    let missingDim = false;
    for (const dim of ds.dimensions) {
      const mem = dimMembers[dim.id] ?? [];
      if (!mem.length) continue;
      let num = 0;
      let den = 0;
      let nObs = 0;
      for (const key of mem) {
        if (z[key] == null) continue;
        const w = weights.indicator[key] ?? 0;
        num += z[key]! * w;
        den += w;
        nObs += 1;
      }
      const need = mem.length >= 2 ? Math.max(2, Math.ceil(mem.length / 2)) : 1;
      if (!den || nObs < need) {
        missingDim = true;
        break;
      }
      const ds_ = num / den;
      dims[dim.id] = ds_;
      const dw = weights.dimension[dim.id] ?? 0;
      comp += ds_ * dw;
      dimWsum += dw;
    }
    if (missingDim || !dimWsum) continue;
    keep.push(i);
    composite.push(comp / dimWsum);
    zList.push(z);
    for (const dim of ds.dimensions) {
      dimScores[dim.id]!.push(dims[dim.id] ?? NaN);
    }
  }

  if (standardize === "zscore") {
    const mn = mean(composite);
    const s = sd(composite);
    for (let i = 0; i < composite.length; i++) {
      composite[i] = s ? 50 + (10 * (composite[i]! - mn)) / s : 50;
    }
    for (const dim of Object.keys(dimScores)) {
      const arr = dimScores[dim]!.map((x) => (Number.isFinite(x) ? x : 0));
      const dm = mean(arr.filter(Number.isFinite));
      const ds_ = sd(arr.filter(Number.isFinite));
      dimScores[dim] = arr.map((x) => (ds_ ? 50 + (10 * (x - dm)) / ds_ : 50));
    }
  } else {
    for (let i = 0; i < composite.length; i++) composite[i] = composite[i]! * 100;
    for (const dim of Object.keys(dimScores)) {
      dimScores[dim] = dimScores[dim]!.map((x) => (Number.isFinite(x) ? x * 100 : NaN));
    }
  }

  const rows: ScoreRow[] = keep.map((rowIndex, i) => {
    const raw = ds.rows[rowIndex]!;
    const z: Record<string, number> = {};
    for (const [k, v] of Object.entries(zList[i]!)) {
      z[k] = v * (standardize === "minmax" ? 100 : 1);
    }
    const dims: Record<string, number> = {};
    for (const dim of ds.dimensions) {
      const v = dimScores[dim.id]?.[i];
      if (v != null && Number.isFinite(v)) dims[dim.id] = v;
    }
    const timeRaw = ds.timeKey ? raw[ds.timeKey] : null;
    const w = sw[rowIndex] ?? 1;
    return {
      rowIndex,
      entity: String(raw[ds.entityKey] ?? ""),
      time: typeof timeRaw === "number" ? timeRaw : timeRaw != null ? Number(timeRaw) : null,
      group: ds.groupKey && raw[ds.groupKey] != null ? String(raw[ds.groupKey]) : null,
      composite: composite[i]!,
      closeness: method === "topsis" ? composite[i] : undefined,
      dims,
      z,
      weight: w > 0 ? w : 0,
    };
  });

  return {
    rows,
    dropped: nRows - rows.length,
    kmo: kmoVal != null && Number.isFinite(kmoVal) ? kmoVal : null,
    method,
  };
}

export function computeScores(
  ds: Dataset,
  weights: WeightTable,
  standardize: Standardize,
  method: AggMethod,
  missing: MissingMode = "listwise",
  tx: TransformSpec = DEFAULT_TRANSFORM,
): ScoreBundle {
  const selected = ds.indicators.filter((i) => i.selected && i.dimensionId);
  const keys = selected.map((i) => i.key);
  const { cols } = preparedCols(ds, keys, tx);
  const dirs = selected.map((i) => i.direction);
  const kmoVal = keys.length >= 3 ? kmo(corrMatrix(cols)) : null;

  if (missing === "pairwise") {
    return scoreAvailable(ds, selected, keys, cols, dirs, weights, standardize, method, kmoVal);
  }

  const aligned = alignCols(cols, missing);
  if (!aligned) return { rows: [], dropped: ds.rows.length, kmo: null, method };

  const norm = aligned.cols.map((col, j) =>
    standardize === "zscore" ? zscoreNorm(col, dirs[j]!) : minmaxNorm(col, dirs[j]!),
  );

  const dimMembers: Record<string, string[]> = {};
  for (const ind of selected) {
    const d = ind.dimensionId!;
    (dimMembers[d] ??= []).push(ind.key);
  }

  const n = aligned.keep.length;
  const dimScores: Record<string, number[]> = {};
  for (const dim of ds.dimensions) {
    const mem = dimMembers[dim.id] ?? [];
    if (!mem.length) continue;
    const arr = Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const key of mem) {
        const j = keys.indexOf(key);
        s += (norm[j]![i] ?? 0) * (weights.indicator[key] ?? 0);
      }
      arr[i] = s;
    }
    dimScores[dim.id] = arr;
  }

  let composite: number[] = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const dim of ds.dimensions) {
      const arr = dimScores[dim.id];
      if (!arr) continue;
      s += arr[i]! * (weights.dimension[dim.id] ?? 0);
    }
    composite[i] = s;
  }

  let closeness: number[] | undefined;
  if (method === "topsis") {
    const wvec = keys.map((k) => {
      const ind = selected.find((x) => x.key === k)!;
      return (weights.indicator[k] ?? 0) * (weights.dimension[ind.dimensionId!] ?? 0);
    });
    const wsum = wvec.reduce((a, b) => a + b, 0) || 1;
    const mm = aligned.cols.map((col, j) => minmaxNorm(col, dirs[j]!));
    const weighted = Array.from({ length: n }, (_, i) =>
      mm.map((col, j) => col[i]! * (wvec[j]! / wsum)),
    );
    closeness = topsisCloseness(weighted);
    composite = closeness;
  }

  if (standardize === "zscore" && method !== "topsis") {
    const mn = mean(composite);
    const s = sd(composite);
    if (s) composite = composite.map((x) => 50 + (10 * (x - mn)) / s);
    else composite = composite.map(() => 50);
    for (const dim of Object.keys(dimScores)) {
      const arr = dimScores[dim]!;
      const dm = mean(arr);
      const ds_ = sd(arr);
      dimScores[dim] = ds_ ? arr.map((x) => 50 + (10 * (x - dm)) / ds_) : arr.map(() => 50);
    }
  } else {
    composite = composite.map((x) => x * 100);
    for (const dim of Object.keys(dimScores)) {
      dimScores[dim] = dimScores[dim]!.map((x) => x * 100);
    }
  }

  const swAll = samplingWeights(ds.rows, ds.weightKey);
  const rows: ScoreRow[] = aligned.keep.map((rowIndex, i) => {
    const raw = ds.rows[rowIndex]!;
    const z: Record<string, number> = {};
    keys.forEach((k, j) => {
      z[k] = (norm[j]![i] ?? 0) * (standardize === "minmax" ? 100 : 1);
    });
    const dims: Record<string, number> = {};
    for (const dim of ds.dimensions) {
      if (dimScores[dim.id]) dims[dim.id] = dimScores[dim.id]![i]!;
    }
    const timeRaw = ds.timeKey ? raw[ds.timeKey] : null;
    const w = swAll[rowIndex] ?? 1;
    return {
      rowIndex,
      entity: String(raw[ds.entityKey] ?? ""),
      time: typeof timeRaw === "number" ? timeRaw : timeRaw != null ? Number(timeRaw) : null,
      group: ds.groupKey && raw[ds.groupKey] != null ? String(raw[ds.groupKey]) : null,
      composite: composite[i]!,
      closeness: closeness ? closeness[i] : undefined,
      dims,
      z,
      weight: w > 0 ? w : 0,
    };
  });

  return {
    rows,
    dropped: ds.rows.length - rows.length,
    kmo: kmoVal != null && Number.isFinite(kmoVal) ? kmoVal : null,
    method,
  };
}

export function latestByEntity(rows: ScoreRow[]): ScoreRow[] {
  const map = new Map<string, ScoreRow>();
  for (const r of rows) {
    const prev = map.get(r.entity);
    if (!prev || (r.time ?? 0) > (prev.time ?? 0)) map.set(r.entity, r);
  }
  return [...map.values()].sort((a, b) => b.composite - a.composite);
}

export function meanByEntity(rows: ScoreRow[]): ScoreRow[] {
  const acc = new Map<
    string,
    { n: number; composite: number; dims: Record<string, number>; group: string | null; weight: number }
  >();
  for (const r of rows) {
    let a = acc.get(r.entity);
    if (!a) {
      a = { n: 0, composite: 0, dims: {}, group: r.group, weight: 0 };
      acc.set(r.entity, a);
    }
    a.n += 1;
    a.composite += r.composite;
    a.weight += r.weight;
    for (const [k, v] of Object.entries(r.dims)) a.dims[k] = (a.dims[k] ?? 0) + v;
  }
  return [...acc.entries()]
    .map(([entity, a]) => ({
      rowIndex: -1,
      entity,
      time: null,
      group: a.group,
      composite: a.n ? a.composite / a.n : 0,
      dims: Object.fromEntries(Object.entries(a.dims).map(([k, v]) => [k, a.n ? v / a.n : 0])),
      z: {},
      weight: a.n ? a.weight / a.n : 0,
    }))
    .sort((a, b) => b.composite - a.composite);
}

export function rankForYear(rows: ScoreRow[], year: number | null): ScoreRow[] {
  if (year == null) return latestByEntity(rows);
  return rows
    .filter((r) => r.time === year)
    .sort((a, b) => b.composite - a.composite);
}

export function groupMeans(rows: ScoreRow[]): {
  group: string;
  n: number;
  nEff: number;
  composite: number;
  dims: Record<string, number>;
  weighted: boolean;
}[] {
  const acc = new Map<
    string,
    { n: number; wsum: number; w2: number; composite: number; dims: Record<string, number> }
  >();
  let anyW = false;
  for (const r of rows) {
    const g = r.group ?? "未分组";
    let a = acc.get(g);
    if (!a) {
      a = { n: 0, wsum: 0, w2: 0, composite: 0, dims: {} };
      acc.set(g, a);
    }
    const w = r.weight > 0 ? r.weight : 0;
    if (w && w !== 1) anyW = true;
    a.n += 1;
    if (!w) continue;
    a.wsum += w;
    a.w2 += w * w;
    a.composite += r.composite * w;
    for (const [k, v] of Object.entries(r.dims)) a.dims[k] = (a.dims[k] ?? 0) + v * w;
  }
  return [...acc.entries()]
    .map(([group, a]) => ({
      group,
      n: a.n,
      nEff: a.w2 ? (a.wsum * a.wsum) / a.w2 : 0,
      composite: a.wsum ? a.composite / a.wsum : 0,
      dims: Object.fromEntries(
        Object.entries(a.dims).map(([k, v]) => [k, a.wsum ? v / a.wsum : 0]),
      ),
      weighted: anyW,
    }))
    .sort((a, b) => b.composite - a.composite);
}

export function flagSummary(rows: ScreenRow[]): string {
  const failed = rows.filter((r) => !r.pass);
  if (!failed.length) return "全部指标通过当前阈值。";
  return failed
    .map((r) => `${r.name}（${r.flags.map((f) => FLAG_LABEL[f]).join("、")}）`)
    .join("；");
}

export const COMPARE_METHODS: AggMethod[] = ["equal", "entropy", "cv", "critic", "pca", "topsis"];

export interface CrossMethod {
  methods: AggMethod[];
  entities: string[];
  ranks: Record<string, Record<string, number>>;
  scores: Record<string, Record<string, number>>;
  spearman: { a: AggMethod; b: AggMethod; rho: number }[];
}

export function crossMethodAnalysis(
  ds: Dataset,
  standardize: Standardize,
  methods: AggMethod[] = COMPARE_METHODS,
  missing: MissingMode = "listwise",
  tx: TransformSpec = DEFAULT_TRANSFORM,
): CrossMethod {
  const ranks: Record<string, Record<string, number>> = {};
  const scores: Record<string, Record<string, number>> = {};
  let entities: string[] = [];
  for (const m of methods) {
    const w = computeWeights(ds, m, missing, tx);
    const b = computeScores(ds, w, standardize, m, missing, tx);
    const latest =
      ds.kind === "panel"
        ? latestByEntity(b.rows)
        : [...b.rows].sort((a, c) => c.composite - a.composite);
    if (!entities.length) entities = latest.map((r) => r.entity);
    ranks[m] = {};
    scores[m] = {};
    latest.forEach((r, i) => {
      ranks[m]![r.entity] = i + 1;
      scores[m]![r.entity] = r.composite;
    });
  }
  const pairs: CrossMethod["spearman"] = [];
  for (let i = 0; i < methods.length; i++) {
    for (let j = i + 1; j < methods.length; j++) {
      const a = methods[i]!;
      const b = methods[j]!;
      const va = entities.map((e) => scores[a]![e] ?? NaN);
      const vb = entities.map((e) => scores[b]![e] ?? NaN);
      pairs.push({ a, b, rho: spearman(va, vb) });
    }
  }
  return { methods, entities, ranks, scores, spearman: pairs };
}

export interface Contribution {
  key: string;
  name: string;
  dim: string;
  contrib: number;
  share: number;
}

export function indicatorContributions(
  ds: Dataset,
  weights: WeightTable,
  row: ScoreRow,
): Contribution[] {
  const selected = ds.indicators.filter((i) => i.selected && i.dimensionId);
  const dimName = Object.fromEntries(ds.dimensions.map((d) => [d.id, d.name]));
  const items = selected.map((ind) => {
    const z = row.z[ind.key] ?? 0;
    const gw = (weights.indicator[ind.key] ?? 0) * (weights.dimension[ind.dimensionId!] ?? 0);
    return {
      key: ind.key,
      name: ind.name,
      dim: dimName[ind.dimensionId!] ?? "",
      contrib: z * gw,
    };
  });
  const sum = items.reduce((a, x) => a + Math.abs(x.contrib), 0);
  return items
    .map((x) => ({ ...x, share: sum ? x.contrib / sum : 0 }))
    .sort((a, b) => b.contrib - a.contrib);
}

export interface InfluenceRow {
  key: string;
  name: string;
  rho: number;
}

/** Spearman ρ of scores vs. original after dropping each indicator. Lower = more influential. */
export function leaveOneOutInfluence(
  ds: Dataset,
  method: AggMethod,
  standardize: Standardize,
  missing: MissingMode,
  tx: TransformSpec = DEFAULT_TRANSFORM,
): InfluenceRow[] {
  const selected = ds.indicators.filter((i) => i.selected && i.dimensionId);
  if (selected.length < 3) return [];
  const baseW = computeWeights(ds, method, missing, tx);
  const base = computeScores(ds, baseW, standardize, method, missing, tx);
  const baseRank =
    ds.kind === "panel"
      ? latestByEntity(base.rows)
      : [...base.rows].sort((a, b) => b.composite - a.composite);
  const entities = baseRank.map((r) => r.entity);
  const baseScores = entities.map((e) => baseRank.find((r) => r.entity === e)?.composite ?? NaN);

  return selected.map((ind) => {
    const next: Dataset = {
      ...ds,
      indicators: ds.indicators.map((i) => (i.key === ind.key ? { ...i, selected: false } : i)),
    };
    const w = computeWeights(next, method, missing, tx);
    const b = computeScores(next, w, standardize, method, missing, tx);
    const ranked =
      ds.kind === "panel"
        ? latestByEntity(b.rows)
        : [...b.rows].sort((a, c) => c.composite - a.composite);
    const scores = entities.map((e) => ranked.find((r) => r.entity === e)?.composite ?? NaN);
    return { key: ind.key, name: ind.name, rho: spearman(baseScores, scores) };
  }).sort((a, b) => a.rho - b.rho);
}
