import { datasetFromCsv, datasetFromParsed } from "./csv";
import { parseDta } from "./dta";
import type { DataRow, Dataset } from "./types";
import { toNum } from "./stats";

const MAX_BYTES = 120 * 1024 * 1024;
const MAX_SHEETS = 100;
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 500;
const MAX_RECTANGULAR_CELLS = 2_000_000;

export function validateSpreadsheetDimensions(rows: number, columns: number, sheetName: string): void {
  if (
    !Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows <= 0 || columns <= 0 ||
    rows > MAX_ROWS || columns > MAX_COLUMNS || rows * columns > MAX_RECTANGULAR_CELLS
  ) {
    throw new Error(
      `工作表「${sheetName}」超出导入限制（最多 ${MAX_ROWS.toLocaleString()} 行、${MAX_COLUMNS} 列且不超过 ${MAX_RECTANGULAR_CELLS.toLocaleString()} 个单元格）。请先裁剪工作表。`,
    );
  }
}

function checkedSheetRange(ref: string, XLSX: typeof import("xlsx"), sheetName: string) {
  let range: ReturnType<typeof XLSX.utils.decode_range>;
  try {
    range = XLSX.utils.decode_range(ref);
  } catch {
    throw new Error(`工作表「${sheetName}」的单元格范围无效。`);
  }
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  validateSpreadsheetDimensions(rows, columns, sheetName);
  return { range, rows };
}

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
        const raw = String(v);
        const s = raw.trim();
        if (/(?:^id$|_id$|hid$|^pid$|^fid$|_code$|^code$|代码|编号|^city$|^城市$|^entity$|姓名|个体|企业)/i.test(hs[j]!)) {
          o[hs[j]!] = raw;
          continue;
        }
        const n = toNum(s);
        o[hs[j]!] = n != null && Number.isInteger(n) && !Number.isSafeInteger(n) ? raw : n != null ? n : raw;
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
  let wb: ReturnType<typeof XLSX.read>;
  try {
    wb = XLSX.read(buffer, { type: "array", raw: true, cellDates: false });
  } catch (error) {
    throw new Error(`无法解析 Excel 文件：${error instanceof Error ? error.message : "文件格式无效"}`);
  }
  if (!wb.SheetNames.length) throw new Error("工作簿没有工作表。");
  if (wb.SheetNames.length > MAX_SHEETS) {
    throw new Error(`工作簿超过 ${MAX_SHEETS} 个工作表，请先删去无关工作表。`);
  }
  let bestName = wb.SheetNames[0]!;
  let bestN = 0;
  for (const n of wb.SheetNames) {
    const sh = wb.Sheets[n];
    if (!sh) continue;
    const ref = sh["!ref"];
    if (!ref) continue;
    const { rows: nrows } = checkedSheetRange(ref, XLSX, n);
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

export const SPREADSHEET_IMPORT_LIMITS = {
  maxBytes: MAX_BYTES,
  maxSheets: MAX_SHEETS,
  maxRows: MAX_ROWS,
  maxColumns: MAX_COLUMNS,
  maxRectangularCells: MAX_RECTANGULAR_CELLS,
} as const;
