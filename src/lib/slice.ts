import type { Dataset } from "./types";

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
