import { toNum } from "./stats";
import type { DataRow, Dataset, DatasetKind, IndicatorMeta } from "./types";
import { uid } from "./utils";
import { buildCatalog, setImportBuffer } from "./catalog";

const ENTITY_HINTS = [
  "城市",
  "city",
  "个体",
  "企业",
  "编号",
  "panel_hid",
  "hid",
  "pid",
  "fid",
  "姓名",
  "name",
  "entity",
  "id",
  "省份",
];
const TIME_HINTS = ["年份", "年度", "year", "wave", "year_id", "yearid"];
const GROUP_HINTS = [
  "省份",
  "部门",
  "区域",
  "分组",
  "village",
  "county",
  "community",
  "group",
  "dept",
  "region",
  "县",
  "社区",
];
const MAX_INDICATORS = 60;
const AUTO_SELECT = 12;
function looksLikeIdColumn(h: string): boolean {
  const s = h.toLowerCase();
  return /(?:^id$|_id$|hid$|^pid$|^fid$|_code$|^code$|代码|编号|^city$|^城市$|^entity$|姓名|个体|企业)/.test(s);
}

function looksLikeMetaColumn(h: string): boolean {
  const s = h.toLowerCase();
  return /(?:经度|纬度|longitude|latitude|_flag$|_source$|_type$|^universe|^administrative)/.test(
    s,
  );
}

function looksLikeWeightColumn(h: string): boolean {
  const s = h.toLowerCase().trim();
  return /^(weight|wgt|pweight|iweight|aweight|fweight|rwt|indweight|samplingweight|权重|抽样权重|样本权重|展开权重|crosssectionalweight)$/i.test(
    s,
  );
}

function guessDirection(name: string): 1 | -1 {
  return /排放|污染|失业|死亡|基尼|能耗|pm2|废水|二氧化硫|化学需氧/.test(name.toLowerCase())
    ? -1
    : 1;
}

function uniqueCount(rows: DataRow[], key: string): number {
  const s = new Set<string>();
  for (const r of rows) s.add(String(r[key] ?? ""));
  return s.size;
}

function fieldMatches(header: string, hint: string): boolean {
  const h = header.trim();
  const a = h.toLowerCase();
  const b = hint.toLowerCase();
  if (a === b) return true;
  if (b === "城市" || b === "city") return a === "城市名称" || a === "city_name";
  if (b === "省份") return a === "province";
  if (b === "id") return a === "id";
  if (b === "village") return a === "village" || a === "village_id" || a.startsWith("village_");
  if (b === "county") return a === "county" || a === "county_id" || a.startsWith("county_");
  if (b === "region") return a === "region" || a === "region_id";
  if (b === "group") return a === "group" || a === "group_id" || a.startsWith("group_");
  if (b === "编号") return a.includes("编号");
  if (b.length <= 2) return false;
  if (b === "year") return a === "year" || a.startsWith("year_") || a.endsWith("_year");
  return a.includes(b);
}

function entityRank(h: string): number {
  if (h === "城市" || h === "city" || h === "城市名称") return 4;
  if (h === "个体" || h === "企业" || h === "姓名") return 3;
  if (h === "省份") return 0;
  return 1;
}

function pickHint(
  headers: string[],
  hints: string[],
  rows: DataRow[],
  preferUnique = false,
): string | undefined {
  const hits = headers.filter((h) => hints.some((k) => fieldMatches(h, k)));
  if (!hits.length) return undefined;
  if (!preferUnique) return hits[0];
  return [...hits].sort((a, b) => {
    const du = uniqueCount(rows, b) - uniqueCount(rows, a);
    if (du) return du;
    return entityRank(b) - entityRank(a) || hits.indexOf(a) - hits.indexOf(b);
  })[0];
}

function indicatorPriority(h: string, fill: number): number {
  let s = fill;
  if (/^DS\d|^ds\d|_OLD__|__/.test(h)) s -= 0.8;
  if (/[\u4e00-\u9fff]/.test(h)) s += 0.2;
  else s -= 0.2;
  if (/\(%|万元|元|人|吨|件|所|个|%\)/.test(h) || h.includes("%")) s += 0.08;
  if (/^integration_|_source_count$/.test(h)) s -= 0.5;
  return s;
}

function fillRate(rows: DataRow[], key: string): number {
  if (!rows.length) return 0;
  let n = 0;
  for (const r of rows) if (typeof r[key] === "number") n++;
  return n / rows.length;
}

function detectDelimiter(src: string): string {
  // Comma and tab are the supported interchange delimiters. Restricting the
  // candidates avoids treating punctuation inside ordinary text as a delimiter.
  const candidates = [",", "\t"];
  const scores = new Map<string, { width: number; consistency: number; total: number }>();
  for (const delimiter of candidates) {
    const counts: number[] = [];
    let quoted = false;
    let fields = 1;
    for (let i = 0; i < src.length && counts.length < 12; i++) {
      const ch = src[i]!;
      if (ch === '"') {
        if (quoted && src[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (!quoted && ch === delimiter) fields++;
      else if (!quoted && ch === "\n") {
        if (fields > 1) counts.push(fields);
        fields = 1;
      }
    }
    if (fields > 1 && counts.length < 12) counts.push(fields);
    const width = counts.length ? Math.max(...counts) : 1;
    const consistency = counts.filter((n) => n === width).length;
    scores.set(delimiter, { width, consistency, total: counts.length });
  }
  return [...candidates].sort((a, b) => {
    const x = scores.get(a)!;
    const y = scores.get(b)!;
    return y.consistency / Math.max(1, y.total) - x.consistency / Math.max(1, x.total) ||
      y.width - x.width || (a === "," ? -1 : 1);
  })[0]!;
}

function uniqueHeaders(raw: string[]): string[] {
  const used = new Set<string>();
  return raw.map((h, i) => {
    let name = h.trim() || `列${i + 1}`;
    if (used.has(name)) {
      let k = 2;
      while (used.has(`${name}_${k}`)) k++;
      name = `${name}_${k}`;
    }
    used.add(name);
    return name;
  });
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delimiter = detectDelimiter(src);
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let inQ = false;
  while (i < src.length) {
    const ch = src[i]!;
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      table.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (inQ) throw new Error("CSV 引号未闭合，请检查字段中的双引号。");
  if (cell.length || row.length) {
    row.push(cell);
    table.push(row);
  }
  if (!table.length) return { headers: [], rows: [] };
  const headers = uniqueHeaders(table[0]!);
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < table.length; r++) {
    const line = table[r]!;
    if (line.every((x) => x.trim() === "")) continue;
    if (line.length !== headers.length) throw new Error(`CSV 第 ${r + 1} 行有 ${line.length} 列，表头有 ${headers.length} 列；请检查缺失字段、分隔符或字段中的引号。`);
    const o: Record<string, string> = {};
    headers.forEach((h, j) => { o[h] = line[j] ?? ""; });
    rows.push(o);
  }
  return { headers, rows };
}

export function datasetFromParsed(
  name: string,
  headers: string[],
  parsed: DataRow[],
  opts?: {
    source?: string;
    names?: Record<string, string>;
    lblnames?: Record<string, string>;
    valueLabelSets?: Record<string, Record<number, string>>;
  },
): Dataset {

  const timeKey = headers.find((h) => TIME_HINTS.some((k) => fieldMatches(h, k)));
  const entityKey =
    pickHint(
      headers.filter((h) => h !== timeKey),
      ENTITY_HINTS,
      parsed,
      true,
    ) ??
    headers.find((h) => {
      const vals = parsed.map((r) => r[h]);
      const nums = vals.filter((v) => typeof v === "number").length;
      return nums / Math.max(vals.length, 1) < 0.6 && h !== timeKey;
    }) ??
    headers[0]!;
  const groupKey = pickHint(
    headers.filter((h) => h !== entityKey && h !== timeKey),
    GROUP_HINTS,
    parsed,
    true,
  );
  const weightKey = headers.find(
    (h) => h !== entityKey && h !== timeKey && h !== groupKey && looksLikeWeightColumn(h),
  );

  const kind: DatasetKind = timeKey ? "panel" : "survey";
  const valueLabels = attachValueLabels(headers, opts?.lblnames ?? {}, opts?.valueLabelSets ?? {});

  const numeric = headers.filter((h) => {
    const present = parsed.map((r) => r[h]).filter((v) => v != null && v !== "");
    return present.length > 0 && present.every((v) => typeof v === "number");
  });

  const dimId = "d1";
  const skip = new Set(
    [entityKey, timeKey, groupKey, weightKey].filter((x): x is string => !!x),
  );
  const ranked = numeric
    .filter(
      (h) =>
        !skip.has(h) &&
        !looksLikeIdColumn(h) &&
        !looksLikeMetaColumn(h) &&
        !looksLikeWeightColumn(h),
    )
    .sort(
      (a, b) => indicatorPriority(b, fillRate(parsed, b)) - indicatorPriority(a, fillRate(parsed, a)),
    );
  const dropped = Math.max(0, ranked.length - MAX_INDICATORS);
  const indicatorKeys = ranked.slice(0, MAX_INDICATORS);
  const autoN = Math.min(indicatorKeys.length, AUTO_SELECT);
  const indicators: IndicatorMeta[] = indicatorKeys.map((key, i) => ({
    key,
    name: opts?.names?.[key] || key,
    direction: guessDirection(opts?.names?.[key] || key),
    dimensionId: dimId,
    selected: i < AUTO_SELECT,
    weight: autoN ? 1 / autoN : 1,
  }));

  // Keep every source field in each imported row; catalog selection only controls
  // which numeric fields are initially treated as indicators.
  const keep = new Set<string>(headers);
  const rows: DataRow[] = parsed.map((r) => {
    const o: DataRow = {};
    for (const k of keep) o[k] = r[k] ?? null;
    return o;
  });

  const extra =
    dropped > 0
      ? `原表有 ${ranked.length} 个数值列，已物化 ${indicatorKeys.length} 个（预选 ${Math.min(AUTO_SELECT, indicatorKeys.length)} 个）。其余可在数据步按题组勾选加入，最多 80 个。`
      : `已按数值列识别 ${indicatorKeys.length} 个指标，预选 ${indicators.filter((i) => i.selected).length} 个。`;

  const src = opts?.source ?? "CSV";
  const wnote = weightKey ? `已识别抽样权重列「${weightKey}」。` : "";
  const vnote = Object.keys(valueLabels).length ? `已读取 ${Object.keys(valueLabels).length} 个变量的值标签。` : "";
  const id = uid("csv");
  const catalog = buildCatalog(parsed, ranked, opts?.names);
  setImportBuffer(id, parsed);
  return {
    id,
    name: name.replace(/\.(csv|tsv|dta|xlsx|xls)$/i, "") || "导入数据",
    kind,
    description: `自 ${src} 导入，${rows.length} 行 × ${headers.length} 列。${extra}${wnote}${vnote}`,
    sourceNote: "本地导入，数据仅保存在本浏览器。宽表题组缓存在本次会话中，刷新后需重新导入才能加入未物化列。",
    rows,
    entityKey,
    timeKey,
    groupKey,
    weightKey,
    idKey: kind === "survey" ? entityKey : undefined,
    indicators,
    dimensions: [
      {
        id: dimId,
        name: "综合维度",
        weight: 1,
        description: "导入后可拆分为多个维度",
        measure: kind === "survey" ? "reflective" : "formative",
      },
    ],
    goalName: "综合指数",
    catalog,
    valueLabels: Object.keys(valueLabels).length ? valueLabels : undefined,
  };
}

function attachValueLabels(
  headers: string[],
  lblnames: Record<string, string>,
  sets: Record<string, Record<number, string>>,
): Record<string, Record<string, string>> {
  const attached: Record<string, Record<string, string>> = {};
  if (!Object.keys(sets).length) return attached;
  for (const h of headers) {
    const setName = lblnames[h];
    const map = setName ? sets[setName] : undefined;
    if (!map) continue;
    const asStr: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) asStr[String(k)] = v;
    attached[h] = asStr;
    // Labels are metadata; source numeric codes remain unchanged.
  }
  return attached;
}

export function datasetFromCsv(name: string, text: string): Dataset {
  const { headers, rows: raw } = parseCsv(text);
  if (!headers.length) throw new Error("未能解析到表头。");
  const parsed: DataRow[] = raw.map((r) => {
    const o: DataRow = {};
    for (const h of headers) {
      const rawValue = r[h] ?? "";
      const v = rawValue.trim();
      if (v === "") { o[h] = null; continue; }
      // Text identifiers retain leading zeroes and digits beyond JS's exact integer range.
      if (looksLikeIdColumn(h) || ENTITY_HINTS.some((hint) => fieldMatches(h, hint))) {
        o[h] = rawValue;
        continue;
      }
      const n = toNum(v);
      if (n != null && Number.isInteger(n) && !Number.isSafeInteger(n)) o[h] = rawValue;
      else o[h] = n != null ? n : rawValue;
    }
    return o;
  });
  return datasetFromParsed(name, headers, parsed, { source: "CSV" });
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  }
  return lines.join("\n");
}

export function templateCsv(kind: DatasetKind): string {
  if (kind === "panel") {
    return toCsv(
      ["城市", "年份", "省份", "人均GDP", "第三产业比重", "城镇化率"],
      [
        { 城市: "示例市A", 年份: 2020, 省份: "某省", 人均GDP: 82000, 第三产业比重: 54.1, 城镇化率: 68.2 },
        { 城市: "示例市A", 年份: 2021, 省份: "某省", 人均GDP: 86800, 第三产业比重: 55.0, 城镇化率: 69.1 },
        { 城市: "示例市B", 年份: 2020, 省份: "某省", 人均GDP: 61000, 第三产业比重: 48.2, 城镇化率: 57.4 },
        { 城市: "示例市B", 年份: 2021, 省份: "某省", 人均GDP: 64200, 第三产业比重: 49.0, 城镇化率: 58.6 },
      ],
    );
  }
  return toCsv(
    ["编号", "省份", "信任_亲友", "信任_陌生人", "生活满意度", "自评健康"],
    [
      { 编号: 1, 省份: "某省", 信任_亲友: 4, 信任_陌生人: 2, 生活满意度: 4, 自评健康: 3 },
      { 编号: 2, 省份: "某省", 信任_亲友: 5, 信任_陌生人: 3, 生活满意度: 5, 自评健康: 4 },
      { 编号: 3, 省份: "某省", 信任_亲友: 3, 信任_陌生人: 2, 生活满意度: 3, 自评健康: 2 },
    ],
  );
}
