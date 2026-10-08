import type { CatalogItem, DataRow, Dataset } from "./types";

const MAX_MATERIALIZED = 80;

export function batteryOf(key: string, name = ""): string {
  const k = key.trim();
  const m = k.match(/^([A-Za-z]{1,6}\d{0,3})/);
  if (m && m[1] && m[1].length >= 2 && /[A-Za-z]/.test(m[1]) && /\d/.test(m[1])) return m[1];
  const tok = k.split(/[_\-./]/)[0] ?? k;
  if (tok.length >= 2 && tok.length <= 16 && tok !== k) return tok;
  const cjk = (name || k).match(/^[\u4e00-\u9fff]{2,4}/);
  if (cjk) return cjk[0];
  return "其他";
}

export function uniqueCount(rows: DataRow[], key: string): number {
  const s = new Set<string>();
  for (const r of rows) s.add(String(r[key] ?? ""));
  return s.size;
}

export function fillRate(rows: DataRow[], key: string): number {
  if (!rows.length) return 0;
  let n = 0;
  for (const r of rows) if (typeof r[key] === "number") n += 1;
  return n / rows.length;
}

export function buildCatalog(
  rows: DataRow[],
  keys: string[],
  names: Record<string, string> = {},
): CatalogItem[] {
  return keys.map((key) => ({
    key,
    name: names[key] || key,
    fill: fillRate(rows, key),
    battery: batteryOf(key, names[key] || key),
    nUnique: uniqueCount(rows, key),
  }));
}

interface ImportBuffer {
  id: string;
  rows: DataRow[];
}

let buffer: ImportBuffer | null = null;

export function setImportBuffer(id: string, rows: DataRow[]) {
  buffer = { id, rows };
}

export function clearImportBuffer() {
  buffer = null;
}

export function getImportBuffer(): ImportBuffer | null {
  return buffer;
}

export function materializeKeys(
  ds: Dataset,
  extraKeys: string[],
): { rows: DataRow[]; added: string[]; skipped: string[] } | null {
  const buf = buffer;
  if (!buf || buf.id !== ds.id) return null;
  if (buf.rows.length !== ds.rows.length) return null;
  const have = new Set(ds.indicators.map((i) => i.key));
  const skipped: string[] = [];
  const added: string[] = [];
  for (const k of extraKeys) {
    if (have.has(k)) continue;
    if (have.size + added.length >= MAX_MATERIALIZED) {
      skipped.push(k);
      continue;
    }
    if (!(k in (buf.rows[0] ?? {}))) {
      skipped.push(k);
      continue;
    }
    added.push(k);
  }
  if (!added.length) return { rows: ds.rows, added, skipped };
  const rows = ds.rows.map((r, i) => {
    const src = buf.rows[i];
    if (!src) return r;
    const o: DataRow = { ...r };
    for (const k of added) o[k] = src[k] ?? null;
    return o;
  });
  return { rows, added, skipped };
}

export const MAX_MATERIALIZED_INDICATORS = MAX_MATERIALIZED;

export function directionFromName(name: string): 1 | -1 {
  return /排放|污染|失业|死亡|基尼|能耗|pm2|废水|二氧化硫|化学需氧/.test(name.toLowerCase())
    ? -1
    : 1;
}

export function displayLabel(
  labels: Record<string, Record<string, string>> | undefined,
  key: string | undefined,
  value: string | number | null,
): string {
  if (value == null || value === "") return "—";
  const s = String(value);
  if (!key || !labels) return s;
  return labels[key]?.[s] ?? s;
}

