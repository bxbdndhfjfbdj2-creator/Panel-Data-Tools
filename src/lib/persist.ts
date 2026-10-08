import { DEFAULT_TRANSFORM } from "./types";
import type {
  AggMethod,
  Dataset,
  LogMode,
  MeasureKind,
  MissingMode,
  ScreeningThresholds,
  Standardize,
  StepId,
  TransformSpec,
  WinsorTail,
} from "./types";

export const WORKSPACE_KEY = "hengce.workspace.v1";

export interface WorkspaceSnap {
  v: 1;
  savedAt: number;
  step: StepId;
  dataset: Dataset;
  thresholds: ScreeningThresholds;
  method: AggMethod;
  standardize: Standardize;
  missingMode?: MissingMode;
  transform?: TransformSpec;
  yearFrom?: number | null;
  yearTo?: number | null;
  resultYear?: number | null;
  resultMode?: "latest" | "mean";
  heatSelectedOnly?: boolean;
}

type ParseWorkspaceResult =
  | { ok: true; value: WorkspaceSnap }
  | { ok: false; error: string };

export interface WorkspaceStorage {
  getItem?: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export type WorkspaceWriteResult =
  | { ok: true; savedAt: number }
  | { ok: false; error: string };

const STEPS = new Set<StepId>(["data", "screen", "system", "aggregate", "results"]);
const METHODS = new Set<AggMethod>([
  "equal", "entropy", "cv", "critic", "pca", "topsis", "custom", "median", "trimmed",
]);
const MISSING_MODES = new Set<MissingMode>(["listwise", "mean", "pairwise"]);
const LOG_MODES = new Set<LogMode>(["off", "ln", "log1p"]);
const WINSOR_TAILS = new Set<WinsorTail>([0, 0.01, 0.05]);
const MEASURES = new Set<MeasureKind>(["reflective", "formative"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalKey(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function error(message: string): ParseWorkspaceResult {
  return { ok: false, error: `方案校验失败：${message}` };
}

function validateDataset(value: unknown): { value: Dataset } | { error: string } {
  if (!isRecord(value)) return { error: "dataset 必须是对象。" };
  const ds = value;
  const requiredStrings = ["id", "name", "description", "sourceNote", "entityKey", "goalName"];
  if (requiredStrings.some((key) => typeof ds[key] !== "string")) {
    return { error: "数据集缺少有效的名称、标识或实体列。" };
  }
  if (ds.kind !== "panel" && ds.kind !== "survey") return { error: "dataset.kind 只能是 panel 或 survey。" };
  if (!Array.isArray(ds.rows) || !Array.isArray(ds.indicators) || !Array.isArray(ds.dimensions)) {
    return { error: "数据集的 rows、indicators、dimensions 必须是数组。" };
  }
  for (const key of ["timeKey", "groupKey", "weightKey", "idKey"] as const) {
    if (!isOptionalKey(ds[key])) return { error: `dataset.${key} 必须是字符串。` };
  }

  for (let index = 0; index < ds.rows.length; index += 1) {
    const row = ds.rows[index];
    if (!isRecord(row)) return { error: `第 ${index + 1} 条数据行必须是对象。` };
    for (const [key, cell] of Object.entries(row)) {
      if (!key || !(cell === null || typeof cell === "string" || isFiniteNumber(cell))) {
        return { error: `第 ${index + 1} 条数据行的「${key}」不是有效的文本、有限数值或空值。` };
      }
    }
  }

  const rowKeys = new Set(ds.rows.flatMap((row) => Object.keys(row as Record<string, unknown>)));
  if (ds.rows.length > 0) {
    for (const key of ["entityKey", "timeKey", "groupKey", "weightKey"] as const) {
      const column = ds[key];
      if (typeof column === "string" && !rowKeys.has(column)) {
        return { error: `dataset.${key}「${column}」未出现在数据列中。` };
      }
    }
  }

  const dimensionIds = new Set<string>();
  for (let index = 0; index < ds.dimensions.length; index += 1) {
    const dimension = ds.dimensions[index];
    if (!isRecord(dimension) || typeof dimension.id !== "string" || !dimension.id.trim() || typeof dimension.name !== "string") {
      return { error: `第 ${index + 1} 个维度缺少有效的 id 或 name。` };
    }
    if (dimensionIds.has(dimension.id)) return { error: `维度 id「${dimension.id}」重复。` };
    dimensionIds.add(dimension.id);
    if (!isFiniteNumber(dimension.weight) || dimension.weight < 0 || dimension.weight > 1) {
      return { error: `维度「${dimension.name}」的权重必须是 0 到 1 之间的有限数。` };
    }
    if (dimension.description !== undefined && typeof dimension.description !== "string") {
      return { error: `维度「${dimension.name}」的 description 必须是字符串。` };
    }
    if (dimension.measure !== undefined && !MEASURES.has(dimension.measure as MeasureKind)) {
      return { error: `维度「${dimension.name}」的 measure 非法。` };
    }
  }

  const indicatorKeys = new Set<string>();
  for (let index = 0; index < ds.indicators.length; index += 1) {
    const indicator = ds.indicators[index];
    if (!isRecord(indicator) || typeof indicator.key !== "string" || !indicator.key.trim() || typeof indicator.name !== "string") {
      return { error: `第 ${index + 1} 个指标缺少有效的 key 或 name。` };
    }
    if (indicatorKeys.has(indicator.key)) return { error: `指标 key「${indicator.key}」重复。` };
    indicatorKeys.add(indicator.key);
    if (indicator.direction !== 1 && indicator.direction !== -1) return { error: `指标「${indicator.name}」的 direction 只能是 1 或 -1。` };
    if (indicator.dimensionId !== null && (typeof indicator.dimensionId !== "string" || !dimensionIds.has(indicator.dimensionId))) {
      return { error: `指标「${indicator.name}」引用了不存在的维度。` };
    }
    if (typeof indicator.selected !== "boolean") return { error: `指标「${indicator.name}」的 selected 必须是布尔值。` };
    if (!isFiniteNumber(indicator.weight) || indicator.weight < 0 || indicator.weight > 1) {
      return { error: `指标「${indicator.name}」的权重必须是 0 到 1 之间的有限数。` };
    }
    for (const key of ["unit", "note"] as const) {
      if (indicator[key] !== undefined && typeof indicator[key] !== "string") return { error: `指标「${indicator.name}」的 ${key} 必须是字符串。` };
    }
    if (indicator.logMode !== undefined && !LOG_MODES.has(indicator.logMode as LogMode)) {
      return { error: `指标「${indicator.name}」的 logMode 非法。` };
    }
    if (ds.rows.length > 0 && !rowKeys.has(indicator.key)) return { error: `指标「${indicator.key}」未出现在数据列中。` };
  }

  if (ds.catalog !== undefined) {
    if (!Array.isArray(ds.catalog)) return { error: "dataset.catalog 必须是数组。" };
    for (const [index, item] of ds.catalog.entries()) {
      if (!isRecord(item) || typeof item.key !== "string" || typeof item.name !== "string" || typeof item.battery !== "string" ||
        !isFiniteNumber(item.fill) || item.fill < 0 || item.fill > 1 || !Number.isSafeInteger(item.nUnique) || (item.nUnique as number) < 0) {
        return { error: `catalog 第 ${index + 1} 项结构无效。` };
      }
    }
  }
  if (ds.valueLabels !== undefined) {
    if (!isRecord(ds.valueLabels)) return { error: "dataset.valueLabels 必须是对象。" };
    for (const [variable, labels] of Object.entries(ds.valueLabels)) {
      if (!isRecord(labels) || Object.values(labels).some((label) => typeof label !== "string")) {
        return { error: `变量「${variable}」的 valueLabels 结构无效。` };
      }
    }
  }

  return { value: ds as unknown as Dataset };
}

function validateThresholds(value: unknown): { value: ScreeningThresholds } | { error: string } {
  if (!isRecord(value)) return { error: "thresholds 必须是对象。" };
  const keys = ["maxMissing", "minCv", "maxAbsCorr", "maxVif", "minItemTotal", "maxFloorCeiling"] as const;
  if (keys.some((key) => !isFiniteNumber(value[key]))) return { error: "thresholds 必须全部是有限数。" };
  for (const key of ["maxMissing", "maxAbsCorr", "minItemTotal", "maxFloorCeiling"] as const) {
    const threshold = value[key] as number;
    if (threshold < 0 || threshold > 1) return { error: `thresholds.${key} 必须在 0 到 1 之间。` };
  }
  if ((value.minCv as number) < 0 || (value.maxVif as number) < 0) return { error: "thresholds.minCv 和 maxVif 不能为负数。" };
  return { value: { ...value } as unknown as ScreeningThresholds };
}

/** Returns a validated, defaulted snapshot and a field-specific reason on failure. */
export function parseWorkspaceResult(raw: unknown): ParseWorkspaceResult {
  if (!isRecord(raw)) return error("根节点必须是对象。");
  if (raw.v !== 1) return error("不支持的方案版本。请使用 v1 方案文件。");
  if (!isFiniteNumber(raw.savedAt) || raw.savedAt < 0) return error("savedAt 必须是非负有限数。");
  if (typeof raw.step !== "string" || !STEPS.has(raw.step as StepId)) return error("step 不属于已知工作步骤。");
  if (typeof raw.method !== "string" || !METHODS.has(raw.method as AggMethod)) return error("method 不属于已知聚合方法。");
  if (raw.standardize !== "minmax" && raw.standardize !== "zscore") return error("standardize 只能是 minmax 或 zscore。");

  const dataset = validateDataset(raw.dataset);
  if ("error" in dataset) return error(dataset.error);
  const thresholds = validateThresholds(raw.thresholds);
  if ("error" in thresholds) return error(thresholds.error);

  const missingMode = raw.missingMode === undefined ? "listwise" : raw.missingMode;
  if (typeof missingMode !== "string" || !MISSING_MODES.has(missingMode as MissingMode)) return error("missingMode 非法。");
  const transformRaw = raw.transform === undefined ? {} : raw.transform;
  if (!isRecord(transformRaw)) return error("transform 必须是对象。");
  const winsor = transformRaw.winsor === undefined ? DEFAULT_TRANSFORM.winsor : transformRaw.winsor;
  const logMode = transformRaw.logMode === undefined ? DEFAULT_TRANSFORM.logMode : transformRaw.logMode;
  if (typeof winsor !== "number" || !WINSOR_TAILS.has(winsor as WinsorTail)) return error("transform.winsor 只能是 0、0.01 或 0.05。");
  if (typeof logMode !== "string" || !LOG_MODES.has(logMode as LogMode)) return error("transform.logMode 非法。");

  const validYear = (year: unknown): year is number | null => year === null || (Number.isSafeInteger(year) && isFiniteNumber(year));
  const yearFrom = raw.yearFrom === undefined ? null : raw.yearFrom;
  const yearTo = raw.yearTo === undefined ? null : raw.yearTo;
  const resultYear = raw.resultYear === undefined ? null : raw.resultYear;
  if (!validYear(yearFrom) || !validYear(yearTo) || !validYear(resultYear)) return error("年份必须是整数年份或 null。");
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) return error("yearFrom 不能大于 yearTo。");
  if (resultYear !== null && ((yearFrom !== null && resultYear < yearFrom) || (yearTo !== null && resultYear > yearTo))) {
    return error("resultYear 必须位于 yearFrom 与 yearTo 范围内。");
  }

  const resultMode = raw.resultMode === undefined ? "latest" : raw.resultMode;
  if (resultMode !== "latest" && resultMode !== "mean") return error("resultMode 只能是 latest 或 mean。");
  const heatSelectedOnly = raw.heatSelectedOnly === undefined ? false : raw.heatSelectedOnly;
  if (typeof heatSelectedOnly !== "boolean") return error("heatSelectedOnly 必须是布尔值。");

  return {
    ok: true,
    value: {
      v: 1,
      savedAt: raw.savedAt,
      step: raw.step as StepId,
      dataset: dataset.value,
      thresholds: thresholds.value,
      method: raw.method as AggMethod,
      standardize: raw.standardize as Standardize,
      missingMode: missingMode as MissingMode,
      transform: { winsor: winsor as WinsorTail, logMode: logMode as LogMode } satisfies TransformSpec,
      yearFrom,
      yearTo,
      resultYear,
      resultMode,
      heatSelectedOnly,
    },
  };
}

export function parseWorkspace(raw: unknown): WorkspaceSnap | null {
  const result = parseWorkspaceResult(raw);
  return result.ok ? result.value : null;
}

function getWorkspaceStorage(): WorkspaceStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readWorkspace(): WorkspaceSnap | null {
  try {
    const storage = getWorkspaceStorage();
    const text = storage?.getItem?.(WORKSPACE_KEY);
    if (!text) return null;
    return parseWorkspace(JSON.parse(text));
  } catch {
    return null;
  }
}

export function writeWorkspace(snap: WorkspaceSnap, storage: WorkspaceStorage | null = getWorkspaceStorage()): WorkspaceWriteResult {
  if (!storage) return { ok: false, error: "浏览器本地存储不可用，当前修改未保存。" };
  const parsed = parseWorkspaceResult(snap);
  if (!parsed.ok) return { ok: false, error: `当前方案无法保存：${parsed.error}` };
  let serialized: string;
  try {
    serialized = JSON.stringify(parsed.value);
    if (typeof serialized !== "string") return { ok: false, error: "方案序列化失败，当前修改未保存。" };
  } catch {
    return { ok: false, error: "方案序列化失败，当前修改未保存。" };
  }
  try {
    storage.setItem(WORKSPACE_KEY, serialized);
    return { ok: true, savedAt: parsed.value.savedAt };
  } catch {
    return { ok: false, error: "浏览器存储空间不足或写入失败，当前修改未保存。" };
  }
}

export function downloadBlob(filename: string, text: string, mime: string) {
  const blob = new Blob(["\uFEFF" + text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
