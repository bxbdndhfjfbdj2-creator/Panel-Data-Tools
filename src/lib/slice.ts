import type { Dataset } from "./types";

export function numericYears(ds: Dataset): number[] {
  if (!ds.timeKey) return [];
  const key = ds.timeKey;
  const ys = new Set<number>();
  for (const r of ds.rows) {
    const v = r[key];
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) ys.add(n);
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
      const n = typeof r[key] === "number" ? (r[key] as number) : Number(r[key]);
      if (!Number.isFinite(n)) return false;
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
