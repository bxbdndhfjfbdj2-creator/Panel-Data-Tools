export type DatasetKind = "panel" | "survey";
export type MeasureKind = "reflective" | "formative";
export type StepId = "data" | "screen" | "system" | "aggregate" | "results";
export type Direction = 1 | -1;
export type AggMethod = "equal" | "entropy" | "cv" | "critic" | "pca" | "topsis" | "custom" | "median" | "trimmed";
export type Standardize = "minmax" | "zscore";
export type MissingMode = "listwise" | "mean" | "pairwise";
export type CorrMethod = "pearson" | "spearman" | "kendall";
export type WinsorTail = 0 | 0.01 | 0.05;
export type LogMode = "off" | "ln" | "log1p";

export interface TransformSpec {
  winsor: WinsorTail;
  logMode: LogMode;
}

export const DEFAULT_TRANSFORM: TransformSpec = { winsor: 0, logMode: "off" };

export interface IndicatorMeta {
  key: string;
  name: string;
  unit?: string;
  direction: Direction;
  dimensionId: string | null;
  selected: boolean;
  /** Leaf weight within its dimension (sums to 1 per dim). */
  weight: number;
  /** Override global log; undefined inherits workspace transform. */
  logMode?: LogMode;
  note?: string;
}

export interface Dimension {
  id: string;
  name: string;
  weight: number;
  description?: string;
  measure?: MeasureKind;
}

export interface CatalogItem {
  key: string;
  name: string;
  fill: number;
  battery: string;
  nUnique: number;
}

export interface DataRow {
  [key: string]: string | number | null;
}

export interface Dataset {
  id: string;
  name: string;
  kind: DatasetKind;
  description: string;
  sourceNote: string;
  rows: DataRow[];
  entityKey: string;
  timeKey?: string;
  groupKey?: string;
  /** Sampling / design weight column. Used in weighted means and entropy. */
  weightKey?: string;
  idKey?: string;
  indicators: IndicatorMeta[];
  dimensions: Dimension[];
  goalName: string;
  /** All numeric candidates from a wide import; rows only keep the materialized subset. */
  catalog?: CatalogItem[];
  /** Value labels keyed by variable then numeric code (as string). */
  valueLabels?: Record<string, Record<string, string>>;
}

export interface ScreeningThresholds {
  maxMissing: number;
  minCv: number;
  maxAbsCorr: number;
  maxVif: number;
  minItemTotal: number;
  maxFloorCeiling: number;
}

export interface ScreenRow {
  key: string;
  name: string;
  n: number;
  missing: number;
  mean: number;
  sd: number;
  cv: number;
  min: number;
  max: number;
  skew: number;
  vif: number | null;
  maxCorr: { key: string; name: string; r: number } | null;
  itemTotal: number | null;
  floor: number | null;
  ceiling: number | null;
  icc: number | null;
  alphaIfDeleted: number | null;
  mad: number;
  rcv: number;
  gapRS: number | null;
  flags: ScreenFlag[];
  pass: boolean;
}

export type ScreenFlag =
  | "missing"
  | "low_cv"
  | "high_corr"
  | "high_vif"
  | "low_item_total"
  | "floor"
  | "ceiling"
  | "constant"
  | "hurts_alpha"
  | "between_corr"
  | "within_redundant"
  | "nonlinear";

export interface WeightTable {
  method: AggMethod;
  indicator: Record<string, number>;
  dimension: Record<string, number>;
  pcaVariance?: number;
  notes: string[];
  error?: string;
}

export interface ScoreRow {
  rowIndex: number;
  entity: string;
  time: number | null;
  group: string | null;
  composite: number;
  closeness?: number;
  dims: Record<string, number>;
  z: Record<string, number>;
  /** Design weight copied from the source row; 1 if none. */
  weight: number;
  /** Optional row-level provenance for downstream summaries. */
  metadata?: Record<string, string | number | boolean | null>;
  contributions?: Record<string, number>;
  contributionIntercept?: number;
}

export interface MethodRanks {
  method: AggMethod;
  label: string;
  scores: number[];
}

export const STEPS: { id: StepId; n: string; label: string; hint: string }[] = [
  { id: "data", n: "01", label: "数据", hint: "CSV · Excel · Stata" },
  { id: "screen", n: "02", label: "筛选", hint: "缺失 · 变异 · 共线" },
  { id: "system", n: "03", label: "体系", hint: "构念 · 维度 · AHP" },
  { id: "aggregate", n: "04", label: "聚合", hint: "赋权与标准化" },
  { id: "results", n: "05", label: "结果", hint: "指数 · 排名 · 诊断" },
];

export const METHOD_META: Record<
  AggMethod,
  { label: string; short: string; blurb: string }
> = {
  equal: {
    label: "等权平均",
    short: "等权",
    blurb: "维度内各指标等权，再按维度权重合成。适合专家尚未赋权、结构已明确的情形。",
  },
  entropy: {
    label: "熵权法",
    short: "熵权",
    blurb: "信息熵越小、离散程度越大的指标获得更高权重。客观赋权，对差异敏感。",
  },
  cv: {
    label: "变异系数",
    short: "CV",
    blurb: "按各指标变异系数占合计的比例赋权。离散程度越高，权重越大。",
  },
  critic: {
    label: "CRITIC",
    short: "CRITIC",
    blurb: "同时考虑标准差与指标间冲突性（1−|r|）。降低高度相关指标的重复计权。",
  },
  pca: {
    label: "主成分",
    short: "PCA",
    blurb: "取相关矩阵第一主成分载荷的绝对值并归一，作为维度内权重。",
  },
  topsis: {
    label: "TOPSIS",
    short: "TOPSIS",
    blurb: "在加权标准化空间中计算与正理想解的相对贴近度，作为综合指数。",
  },
  custom: {
    label: "自定义权重",
    short: "自定义",
    blurb: "手工指定维度权重与指标权重。适用于德尔菲或已有专家打分。",
  },
  median: {
    label: "中位数合成",
    short: "中位数",
    blurb: "维度内对标准化后的指标取中位数，再按维度权重合成。抗异常值，不估计客观权重。",
  },
  trimmed: {
    label: "切尾均值",
    short: "切尾",
    blurb: "维度内去掉两端各 10% 后取均值再合成。削弱极值，仍保留多数信息。",
  },
};

export const FLAG_LABEL: Record<ScreenFlag, string> = {
  missing: "缺失偏高",
  low_cv: "变异不足",
  high_corr: "高度相关",
  high_vif: "VIF 偏高",
  low_item_total: "题总相关低",
  floor: "地板效应",
  ceiling: "天花板效应",
  constant: "近似常数",
  hurts_alpha: "降低信度",
  between_corr: "维间高相关",
  within_redundant: "维内冗余",
  nonlinear: "非线性",
};

export const DEFAULT_THRESHOLDS: ScreeningThresholds = {
  maxMissing: 0.15,
  minCv: 0.04,
  maxAbsCorr: 0.9,
  maxVif: 10,
  minItemTotal: 0.3,
  maxFloorCeiling: 0.5,
};
