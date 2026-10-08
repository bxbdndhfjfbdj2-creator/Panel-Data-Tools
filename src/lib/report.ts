import { flagSummary, type CrossMethod, type InfluenceRow } from "./engine";
import type { SensitivitySummary, YearStability } from "./diagnose";
import { actualLatestYear, describeActualYears, numericYears, resultPeriodLabel, resultViewDescription } from "./slice";
import {
  FLAG_LABEL,
  METHOD_META,
  type AggMethod,
  type Dataset,
  type MissingMode,
  type ScreenRow,
  type ScoreRow,
  type ScreeningThresholds,
  type Standardize,
  type TransformSpec,
  type WeightTable,
} from "./types";
import { fmt, fmtPct } from "./utils";

export function markdownText(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, "§MDLINE§")
    .replace(/([`*_{}<>\x5b\x5d])/g, "\\$1")
    .replace(/§MDLINE§/g, "<br>");
}

export function stableDataHash(value: unknown): string {
  const source = JSON.stringify(value);
  let hashA = 2166136261;
  let hashB = 2246822519;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    hashA = Math.imul(hashA ^ code, 16777619);
    hashB = Math.imul(hashB ^ (code + i), 3266489917);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, "0")}${(hashB >>> 0).toString(16).padStart(8, "0")}`;
}

export function allocateExportFilename(base: string, extension: string, existing: Iterable<string>): string {
  const forbidden = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);
  const safeBase = Array.from(base.normalize("NFKC"), (char) => {
    const code = char.charCodeAt(0);
    return forbidden.has(char) || code < 32 ? "_" : char;
  }).join("").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim() || "export";
  const ext = extension.replace(/^\.+/, "").replace(/[^a-zA-Z0-9_-]/g, "") || "txt";
  const names = new Set(existing);
  const first = `${safeBase}.${ext}`;
  if (!names.has(first)) return first;
  let n = 2;
  while (names.has(`${safeBase} (${n}).${ext}`)) n++;
  return `${safeBase} (${n}).${ext}`;
}

const sessionUsedFilenames = new Set<string>();

export function claimSessionExportFilename(
  base: string,
  extension: string,
  persistedNames: Iterable<string>,
  sessionNames: Set<string> = sessionUsedFilenames,
): string {
  const filename = allocateExportFilename(base, extension, [...persistedNames, ...sessionNames]);
  sessionNames.add(filename);
  return filename;
}

export function nextExportFilename(base: string, extension: string): string {
  const storageKey = "hengce.export-filenames.v1";
  let names: string[] = [];
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(storageKey);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (Array.isArray(parsed)) names = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    names = [];
  }
  const filename = claimSessionExportFilename(base, extension, names);
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, JSON.stringify([...names, filename].slice(-2000)));
  } catch {
    // The unique in-memory result still avoids same-session collisions when storage is unavailable.
  }
  return filename;
}

export function buildMarkdownReport(opts: {
  dataset: Dataset;
  sourceDataset?: Dataset;
  method: AggMethod;
  standardize: Standardize;
  missingMode: MissingMode;
  transform?: TransformSpec;
  yearFrom: number | null;
  yearTo: number | null;
  thresholds: ScreeningThresholds;
  screen: ScreenRow[];
  weights: WeightTable;
  ranking: ScoreRow[];
  kmo: number | null;
  dropped: number;
  alpha: number | null;
  view?: { mode: "latest" | "mean" | "year"; year: number | null };
  sensitivity?: SensitivitySummary;
  stability?: YearStability | null;
  crossMethod?: CrossMethod;
  influence?: InfluenceRow[];
}): string {
  const {
    dataset: ds,
    method,
    standardize,
    missingMode,
    transform,
    yearFrom,
    yearTo,
    thresholds,
    screen,
    weights,
    ranking,
    kmo,
    dropped,
    alpha,
  } = opts;
  const source = opts.sourceDataset ?? ds;
  const view = opts.view ?? { mode: "latest" as const, year: null };
  const selected = ds.indicators.filter((i) => i.selected && i.dimensionId);
  const entities = new Set(ds.rows.map((r) => String(r[ds.entityKey])));
  const years = numericYears(ds);
  const dataHash = stableDataHash({ datasetId: ds.id, rows: ds.rows });
  const selectedHashConfig = selected.map((i) => ({
    key: i.key,
    direction: i.direction,
    logMode: i.logMode ?? "inherit",
    weight: i.weight,
    dimensionId: i.dimensionId,
  }));
  const dimensionsHashConfig = ds.dimensions.map((d) => ({ id: d.id, name: d.name, weight: d.weight }));
  const hashPayload = {
    dataHash,
    method,
    standardize,
    missingMode,
    transform: transform ?? { winsor: 0, logMode: "off" },
    yearFrom,
    yearTo,
    view,
    thresholds,
    selected: selectedHashConfig,
    dimensions: dimensionsHashConfig,
    weights,
  };
  const runId = stableDataHash(hashPayload);
  const lines: string[] = [];

  lines.push(`# ${markdownText(ds.goalName)}`);
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN")}`);
  lines.push(`- 运行版本：衡策结果报告 v2；运行 ID：${runId}；数据哈希：${dataHash}`);
  lines.push("- 运行哈希算法：衡策双 32 位 FNV-1a 配置哈希；下面的 JSON 是运行 ID 的完整输入（dataHash 由数据集 ID 与当前窗口数据行生成），数值为可复算的原始精度配置。");
  lines.push("```json");
  lines.push(JSON.stringify(hashPayload, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## 一、数据");
  lines.push(`- 名称：${markdownText(ds.name)}`);
  lines.push(`- 类型：${ds.kind === "panel" ? "面板数据" : "问卷数据"}`);
  lines.push(`- 观测：${ds.rows.length} 行；个体 / 样本 ${entities.size} 个`);
  lines.push(`- 全量观测：${source.rows.length} 行；实体 ${new Set(source.rows.map((r) => String(r[source.entityKey] ?? ""))).size} 个`);
  if (ds.timeKey) lines.push(`- 时间列：${markdownText(ds.timeKey)}；当前数据实际年份：${describeActualYears(years)}；最新实际年份：${actualLatestYear(ds) ?? "无"}`);
  if (ds.groupKey) lines.push(`- 分组列：${markdownText(ds.groupKey)}`);
  if (yearFrom != null || yearTo != null) {
    lines.push(`- 分析窗口：${yearFrom ?? "始"}–${yearTo ?? "末"}`);
  }
  lines.push(`- 结果视图：${resultViewDescription(ds.kind, view, actualLatestYear(ds))}`);
  lines.push(`- 说明：${markdownText(ds.sourceNote)}`);
  lines.push("");
  lines.push("## 二、指标筛选");
  lines.push(markdownText(flagSummary(screen)));
  lines.push("");
  lines.push("| 指标 | 判定 | 缺失 | 均值 | SD | CV | VIF |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of screen) {
    const mark = r.pass ? "通过" : r.flags.map((f) => FLAG_LABEL[f]).join("、");
    lines.push(
      `| ${markdownText(r.name)} | ${markdownText(mark)} | ${fmtPct(r.missing)} | ${fmt(r.mean)} | ${fmt(r.sd)} | ${fmt(r.cv, 3)} | ${fmt(r.vif, 1)} |`,
    );
  }
  lines.push("");
  lines.push("## 三、指标体系");
  lines.push(`目标层：${markdownText(ds.goalName)}`);
  lines.push("");
  for (const dim of ds.dimensions) {
    const members = selected.filter((i) => i.dimensionId === dim.id);
    lines.push(`### ${markdownText(dim.name)}（权重 ${fmtPct(weights.dimension[dim.id] ?? dim.weight)} · ${dim.measure === "reflective" ? "反映性" : dim.measure === "formative" ? "形成性" : "未标测量模型"}）`);
    if (dim.description) lines.push(markdownText(dim.description));
    for (const ind of members) {
      const lw = weights.indicator[ind.key] ?? 0;
      const gw = lw * (weights.dimension[dim.id] ?? 0);
      lines.push(
        `- ${markdownText(ind.name)}${ind.unit ? `（${markdownText(ind.unit)}）` : ""} · ${ind.direction === 1 ? "正向" : "负向"} · 维内 ${fmtPct(lw)} · 全局 ${fmtPct(gw)} · key \`${markdownText(ind.key)}\``,
      );
    }
    lines.push("");
  }

  lines.push("## 四、聚合");
  lines.push(`- 方法：${METHOD_META[method].label}`);
  lines.push(`- 标准化：${standardize === "minmax" ? "极差 [0,1]" : "Z 分数"}`);
  lines.push(
    `- 缺失：${missingMode === "mean" ? "列均值填补" : missingMode === "pairwise" ? "可用指标重标（赋权均值填补）" : "整行删除（listwise）"}`,
  );
  if (transform?.winsor) {
    const p = Math.round(transform.winsor * 100);
    lines.push(`- 缩尾：${p}% / ${100 - p}% 分位`);
  }
  lines.push(`- 参数：method=${method}; standardize=${standardize}; missing=${missingMode}; transform=${transform ? `winsor=${transform.winsor}, logMode=${transform.logMode}` : "winsor=0, logMode=off"}`);
  lines.push(`- 实际纳入指标 keys：${selected.map((i) => `\`${markdownText(i.key)}\``).join(", ") || "无"}`);
  lines.push(`- 维度权重（dimension id / name / 配置 weight → 实际计算权重）：${ds.dimensions.map((d) => `${markdownText(d.id)} / ${markdownText(d.name)}：${fmt(d.weight, 6)} → ${fmt(weights.dimension[d.id] ?? 0, 6)}`).join("；") || "无"}`);
  lines.push(`- 指标权重（key / dimensionId / 配置 weight → 维内实际权重 → 全局实际权重）：${selected.map((i) => `${markdownText(i.key)} / ${markdownText(i.dimensionId)}：${fmt(i.weight, 6)} → ${fmt(weights.indicator[i.key] ?? 0, 6)} → ${fmt((weights.indicator[i.key] ?? 0) * (weights.dimension[i.dimensionId!] ?? 0), 6)}`).join("；") || "无"}`);
  lines.push(`- 筛选阈值：最大缺失率 ${fmtPct(thresholds.maxMissing)}；最低 CV ${fmt(thresholds.minCv, 4)}；最大 |相关系数| ${fmt(thresholds.maxAbsCorr, 4)}；最大 VIF ${fmt(thresholds.maxVif, 4)}；最低题总相关 ${fmt(thresholds.minItemTotal, 4)}；最大地板/天花板比例 ${fmtPct(thresholds.maxFloorCeiling)}`);
  lines.push("- 纳入指标方向与对数变换：");
  for (const ind of selected) {
    const logMode = ind.logMode == null
      ? `继承全局（${transform?.logMode ?? "off"}）`
      : `指标覆盖（${ind.logMode}）`;
    lines.push(`  - ${markdownText(ind.key)}：${ind.direction === 1 ? "正向" : "负向"}；logMode=${markdownText(logMode)}`);
  }
  if (transform?.logMode === "ln") lines.push("- 变换：ln(x)，非正视为缺失");
  if (transform?.logMode === "log1p") lines.push("- 变换：ln(1+x)，负值视为缺失");
  if (ds.weightKey) lines.push(`- 抽样权重列：${markdownText(ds.weightKey)}（分组均值为加权；个体排名仍按综合指数）`);
  if (dropped) lines.push(`- 因缺失删除 ${dropped} 条观测`);
  if (kmo != null) lines.push(`- KMO：${fmt(kmo, 3)}`);
  if (alpha != null) lines.push(`- Cronbach α：${fmt(alpha, 3)}`);
  for (const n of weights.notes) lines.push(`- ${markdownText(n)}`);
  lines.push("");
  lines.push("## 五、综合结果");
  lines.push(`共 ${ranking.length} 个${ds.kind === "panel" ? "个体" : "样本"}纳入排名（${resultViewDescription(ds.kind, view, actualLatestYear(ds))}）。`);
  lines.push("");
  lines.push("| 排名 | 名称 | 观测期 | 综合指数 | 分组 |");
  lines.push("| --- | --- | --- | --- | --- |");
  ranking.slice(0, 40).forEach((r, i) => {
    lines.push(`| ${i + 1} | ${markdownText(r.entity)} | ${resultPeriodLabel(ds.kind, view, r.time)} | ${fmt(r.composite, 2)} | ${markdownText(r.group ?? "—")} |`);
  });
  if (opts.crossMethod) {
    lines.push("");
    lines.push("## 六、方法对照（同一窗口与结果视图）");
    lines.push(`- 纳入方法：${opts.crossMethod.methods.join("、") || "无"}`);
    lines.push(`- 跳过方法：${Object.entries(opts.crossMethod.skipped).map(([m, why]) => `${m}：${markdownText(why)}`).join("；") || "无"}`);
    lines.push(`- 当前实体对照数：${opts.crossMethod.entities.length}`);
  }
  if (opts.influence) {
    lines.push("");
    lines.push("## 七、留一指标敏感性");
    lines.push("| 指标 | 排名相关 ρ |\n| --- | ---: |");
    for (const r of opts.influence) lines.push(`| ${markdownText(r.name)} | ${fmt(r.rho, 4)} |`);
  }
  if (opts.sensitivity) {
    lines.push("");
    lines.push("## 八、重抽样敏感性范围");
    const s = opts.sensitivity;
    lines.push(`- 状态：${s.status === "active" ? "已计算" : `停用（${s.reason ?? "未知原因"}）`}; 请求 B=${s.requestedB}；有效 B=${s.effectiveB}；seed=${s.seed}`);
    lines.push("- 以下为重抽样敏感性范围，不是完整置信区间。");
    lines.push("| 实体 | 下界 | 上界 |\n| --- | ---: | ---: |");
    for (const [e, range] of Object.entries(s.ranges)) lines.push(`| ${markdownText(e)} | ${fmt(range.lo, 3)} | ${fmt(range.hi, 3)} |`);
  }
  if (opts.stability) {
    lines.push("");
    lines.push("## 九、年度稳定性（当前窗口）");
    lines.push(`- 参与年份：${opts.stability.years.join("、") || "无"}；均值 ρ：${fmt(opts.stability.meanRho, 4)}`);
    lines.push("| 年份 | ρ | 实体数 |\n| ---: | ---: | ---: |");
    for (const r of opts.stability.rho) lines.push(`| ${r.year} | ${fmt(r.rho, 4)} | ${r.n} |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("本报告由衡策在浏览器本地生成。示意样本不可作为正式统计引用。");
  return lines.join("\n");
}

export function buildCodebook(ds: Dataset): string {
  const lines: string[] = [];
  lines.push(`# ${markdownText(ds.goalName)} · 指标码本`);
  lines.push("");
  lines.push(`数据集：${markdownText(ds.name)}（${ds.kind === "panel" ? "面板" : "问卷"}）`);
  lines.push(`实体列：${markdownText(ds.entityKey)}${ds.timeKey ? `；时间列：${markdownText(ds.timeKey)}` : ""}${ds.groupKey ? `；分组列：${markdownText(ds.groupKey)}` : ""}`);
  lines.push("");
  lines.push("## 层级");
  lines.push("");
  lines.push("```");
  lines.push(markdownText(ds.goalName));
  for (const dim of ds.dimensions) {
    const members = ds.indicators.filter((i) => i.dimensionId === dim.id);
    lines.push(`├─ ${markdownText(dim.name)}  ${fmtPct(dim.weight, 0)}`);
    members.forEach((ind, i) => {
      const last = i === members.length - 1;
      const mark = ind.selected ? "" : " [未纳入]";
      lines.push(
        `│  ${last ? "└" : "├"}─ ${markdownText(ind.name)}${ind.unit ? ` (${markdownText(ind.unit)})` : ""}  ${ind.direction === 1 ? "+" : "−"}${mark}`,
      );
    });
  }
  lines.push("```");
  lines.push("");
  lines.push("## 字典");
  lines.push("");
  lines.push("| 字段 | 名称 | 单位 | 方向 | 维度 | 纳入 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const ind of ds.indicators) {
    const dim = ds.dimensions.find((d) => d.id === ind.dimensionId)?.name ?? "—";
    lines.push(
      `| ${markdownText(ind.key)} | ${markdownText(ind.name)} | ${markdownText(ind.unit ?? "—")} | ${ind.direction === 1 ? "正向" : "负向"} | ${markdownText(dim)} | ${ind.selected ? "是" : "否"} |`,
    );
  }
  lines.push("");
  if (ds.indicators.some((i) => i.note)) {
    lines.push("## 备注");
    for (const ind of ds.indicators) {
      if (ind.note) lines.push(`- ${markdownText(ind.name)}：${markdownText(ind.note)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
