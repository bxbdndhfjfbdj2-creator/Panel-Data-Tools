import type { Dataset, DatasetKind } from "./types";

export type ResultPeriodView = { mode: "latest" | "mean" | "year"; year: number | null };

export function resultPeriodLabel(kind: DatasetKind, view: ResultPeriodView, time: number | null): string {
  if (view.mode === "mean") return "时期均值";
  if (kind === "survey" || time == null) return "无时间";
  return `${time} 年`;
}

export function resultViewDescription(kind: DatasetKind, view: ResultPeriodView, latestYear: number | null): string {
  if (kind === "survey") return "问卷样本得分";
  if (view.mode === "mean") return "所选时期内个体均值";
  if (view.mode === "year") return `指定年份 ${view.year ?? "无"}`;
  return latestYear == null
    ? "各实体最新观测（无有效年份）"
    : `各实体最新实际观测（最新实际年份 ${latestYear}；各实体年份可能不同）`;
}

export function describeActualYears(years: number[]): string {
  if (!years.length) return "无有效年份";
  const continuous = years.every((year, index) => index === 0 || year === years[index - 1]! + 1);
  if (continuous) return `${years[0]}–${years.at(-1)}（连续，共 ${years.length} 年）`;
  if (years.length <= 20) return `${years.join("、")}（非连续，共 ${years.length} 个实际年份）`;
  return `${years[0]}–${years.at(-1)}（存在年份缺口，共 ${years.length} 个实际年份）`;
}

export function numericYear(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function actualLatestYear(ds: Dataset): number | null {
  if (!ds.timeKey) return null;
  let latest: number | null = null;
  for (const row of ds.rows) {
    const year = numericYear(row[ds.timeKey]);
    if (year != null && (latest == null || year > latest)) latest = year;
  }
  return latest;
}

export interface AnalysisContext {
  dataset: Dataset;
  window: { from: number | null; to: number | null };
  actualYears: number[];
  latestYear: number | null;
  view: { mode: "latest" | "mean" | "year"; year: number | null };
  observations: number;
  entities: number;
}

export function buildAnalysisContext(
  source: Dataset,
  yearFrom: number | null,
  yearTo: number | null,
  resultMode: "latest" | "mean",
  resultYear: number | null,
): AnalysisContext {
  const dataset = sliceByYear(source, yearFrom, yearTo);
  const actualYears = numericYears(dataset);
  const view = resultMode === "mean"
    ? { mode: "mean" as const, year: null }
    : resultYear != null && actualYears.includes(resultYear)
      ? { mode: "year" as const, year: resultYear }
      : { mode: "latest" as const, year: null };
  return {
    dataset,
    window: { from: yearFrom, to: yearTo },
    actualYears,
    latestYear: actualYears.at(-1) ?? null,
    view,
    observations: dataset.rows.length,
    entities: entityCount(dataset),
  };
}

export function numericYears(ds: Dataset): number[] {
  if (!ds.timeKey) return [];
  const key = ds.timeKey;
  const ys = new Set<number>();
  for (const r of ds.rows) {
    const n = numericYear(r[key]);
    if (n != null) ys.add(n);
  }
  return [...ys].sort((a, b) => a - b);
}

export function sliceByYear(
  ds: Dataset,
  yearFrom: number | null,
  yearTo: number | null,
): Dataset {
  if (!ds.timeKey || (yearFrom == null && yearTo == null)) return ds;
  const key = ds.timeKey;
  return {
    ...ds,
    rows: ds.rows.filter((r) => {
      const n = numericYear(r[key]);
      if (n == null) return false;
      if (yearFrom != null && n < yearFrom) return false;
      if (yearTo != null && n > yearTo) return false;
      return true;
    }),
  };
}

export function entityCount(ds: Dataset): number {
  return new Set(ds.rows.map((r) => String(r[ds.entityKey] ?? ""))).size;
}

export function groupCount(ds: Dataset): number {
  if (!ds.groupKey) return 0;
  return new Set(ds.rows.map((r) => String(r[ds.groupKey!] ?? ""))).size;
}
