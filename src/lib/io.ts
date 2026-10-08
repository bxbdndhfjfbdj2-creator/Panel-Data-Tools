import { datasetFromCsv, datasetFromParsed } from "./csv";
import { parseDta } from "./dta";
import type { DataRow, Dataset } from "./types";
import { toNum } from "./stats";

const MAX_BYTES = 120 * 1024 * 1024;

function uniqueHeaders(raw: string[]): string[] {
  const used = new Set<string>();
  return raw.map((h, i) => {
    let name = (h || "").trim() || `列${i + 1}`;
    if (used.has(name)) {
      let k = 2;
      while (used.has(`${name}_${k}`)) k++;
      name = `${name}_${k}`;
    }
    used.add(name);
    return name;
  });
}

function gridToRows(headers: string[], body: unknown[][]): { headers: string[]; parsed: DataRow[] } {
  const hs = uniqueHeaders(headers);
  const parsed: DataRow[] = body
    .filter((row) => row.some((c) => c != null && String(c).trim() !== ""))
    .map((row) => {
      const o: DataRow = {};
      for (let j = 0; j < hs.length; j++) {
        const v = row[j];
        if (v == null || v === "") {
          o[hs[j]!] = null;
          continue;
        }
        if (typeof v === "number" && Number.isFinite(v)) {
          o[hs[j]!] = v;
          continue;
        }
        const s = String(v).trim();
        const n = toNum(s);
        o[hs[j]!] = n != null ? n : s === "" ? null : s;
      }
      return o;
    });
  return { headers: hs, parsed };
}

export function datasetFromDta(name: string, buffer: ArrayBuffer): Dataset {
  const table = parseDta(buffer);
  return datasetFromParsed(name, table.headers, table.rows, {
    source: "Stata .dta",
    names: table.labels,
    lblnames: table.lblnames,
    valueLabelSets: table.valueLabels,
  });
}

export async function datasetFromSpreadsheet(name: string, buffer: ArrayBuffer): Promise<Dataset> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array", raw: true, cellDates: false });
  if (!wb.SheetNames.length) throw new Error("工作簿没有工作表。");
  let bestName = wb.SheetNames[0]!;
  let bestN = 0;
  for (const n of wb.SheetNames) {
    const sh = wb.Sheets[n];
    if (!sh) continue;
    const ref = sh["!ref"];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const nrows = range.e.r - range.s.r + 1;
    if (nrows > bestN) {
      bestN = nrows;
      bestName = n;
    }
  }
  const sheet = wb.Sheets[bestName];
  if (!sheet) throw new Error("无法读取工作表。");
  const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  const headerRow = aoa.find((row) => row.some((c) => c != null && String(c).trim() !== ""));
  if (!headerRow) throw new Error("工作表没有表头。");
  const hi = aoa.indexOf(headerRow);
  const headers = headerRow.map((c) => (c == null ? "" : String(c)));
  const { headers: hs, parsed } = gridToRows(headers, aoa.slice(hi + 1));
  if (!parsed.length) throw new Error("工作表没有数据行。");
  const extra = wb.SheetNames.length > 1 ? `（工作表「${bestName}」）` : "";
  return datasetFromParsed(name, hs, parsed, { source: `Excel${extra}` });
}

export async function datasetFromFile(file: File): Promise<Dataset> {
  if (file.size > MAX_BYTES) {
    throw new Error("文件超过 120 MB。请先在 Stata / Excel 中裁成分析子集再导入。");
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "dta") return datasetFromDta(file.name, await file.arrayBuffer());
  if (ext === "xlsx" || ext === "xls") {
    return datasetFromSpreadsheet(file.name, await file.arrayBuffer());
  }
  return datasetFromCsv(file.name, await file.text());
}
