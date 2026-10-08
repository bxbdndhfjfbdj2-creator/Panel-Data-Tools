import { flagSummary } from "./engine";
import {
  FLAG_LABEL,
  METHOD_META,
  type AggMethod,
  type Dataset,
  type MissingMode,
  type ScreenRow,
  type ScoreRow,
  type Standardize,
  type TransformSpec,
  type WeightTable,
} from "./types";
import { fmt, fmtPct } from "./utils";

export function buildMarkdownReport(opts: {
  dataset: Dataset;
  method: AggMethod;
  standardize: Standardize;
  missingMode: MissingMode;
  transform?: TransformSpec;
  yearFrom: number | null;
  yearTo: number | null;
  screen: ScreenRow[];
  weights: WeightTable;
  ranking: ScoreRow[];
  kmo: number | null;
  dropped: number;
  alpha: number | null;
}): string {
  const {
    dataset: ds,
    method,
    standardize,
    missingMode,
    transform,
    yearFrom,
    yearTo,
    screen,
    weights,
    ranking,
    kmo,
    dropped,
    alpha,
  } = opts;
  const selected = ds.indicators.filter((i) => i.selected && i.dimensionId);
  const entities = new Set(ds.rows.map((r) => String(r[ds.entityKey])));
  const lines: string[] = [];

  lines.push(`# ${ds.goalName}`);
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString("zh-CN")}`);
  lines.push("");
  lines.push("## 一、数据");
  lines.push(`- 名称：${ds.name}`);
  lines.push(`- 类型：${ds.kind === "panel" ? "面板数据" : "问卷数据"}`);
  lines.push(`- 观测：${ds.rows.length} 行；个体 / 样本 ${entities.size} 个`);
  if (ds.timeKey) lines.push(`- 时间列：${ds.timeKey}`);
  if (ds.groupKey) lines.push(`- 分组列：${ds.groupKey}`);
  if (yearFrom != null || yearTo != null) {
    lines.push(`- 分析窗口：${yearFrom ?? "始"}–${yearTo ?? "末"}`);
  }
  lines.push(`- 说明：${ds.sourceNote}`);
  lines.push("");
  lines.push("## 二、指标筛选");
  lines.push(flagSummary(screen));
  lines.push("");
  lines.push("| 指标 | 判定 | 缺失 | 均值 | SD | CV | VIF |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of screen) {
    const mark = r.pass ? "通过" : r.flags.map((f) => FLAG_LABEL[f]).join("、");
    lines.push(
      `| ${r.name} | ${mark} | ${fmtPct(r.missing)} | ${fmt(r.mean)} | ${fmt(r.sd)} | ${fmt(r.cv, 3)} | ${fmt(r.vif, 1)} |`,
    );
  }
  lines.push("");
  lines.push("## 三、指标体系");
  lines.push(`目标层：${ds.goalName}`);
  lines.push("");
  for (const dim of ds.dimensions) {
    const members = selected.filter((i) => i.dimensionId === dim.id);
    lines.push(`### ${dim.name}（权重 ${fmtPct(weights.dimension[dim.id] ?? dim.weight)} · ${dim.measure === "reflective" ? "反映性" : dim.measure === "formative" ? "形成性" : "未标测量模型"}）`);
    if (dim.description) lines.push(dim.description);
    for (const ind of members) {
      const lw = weights.indicator[ind.key] ?? 0;
      const gw = lw * (weights.dimension[dim.id] ?? 0);
      lines.push(
        `- ${ind.name}${ind.unit ? `（${ind.unit}）` : ""} · ${ind.direction === 1 ? "正向" : "负向"} · 维内 ${fmtPct(lw)} · 全局 ${fmtPct(gw)}`,
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
  if (transform?.logMode === "ln") lines.push("- 变换：ln(x)，非正视为缺失");
  if (transform?.logMode === "log1p") lines.push("- 变换：ln(1+x)，负值视为缺失");
  if (ds.weightKey) lines.push(`- 抽样权重列：${ds.weightKey}（分组均值为加权；个体排名仍按综合指数）`);
  if (dropped) lines.push(`- 因缺失删除 ${dropped} 条观测`);
  if (kmo != null) lines.push(`- KMO：${fmt(kmo, 3)}`);
  if (alpha != null) lines.push(`- Cronbach α：${fmt(alpha, 3)}`);
  for (const n of weights.notes) lines.push(`- ${n}`);
  lines.push("");
  lines.push("## 五、综合结果");
  lines.push(`共 ${ranking.length} 个${ds.kind === "panel" ? "个体（所选年份）" : "样本"}纳入排名。`);
  lines.push("");
  lines.push("| 排名 | 名称 | 综合指数 | 分组 |");
  lines.push("| --- | --- | --- | --- |");
  ranking.slice(0, 40).forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.entity} | ${fmt(r.composite, 2)} | ${r.group ?? "—"} |`);
  });
  lines.push("");
  lines.push("---");
  lines.push("本报告由衡策在浏览器本地生成。示意样本不可作为正式统计引用。");
  return lines.join("\n");
}

export function buildCodebook(ds: Dataset): string {
  const lines: string[] = [];
  lines.push(`# ${ds.goalName} · 指标码本`);
  lines.push("");
  lines.push(`数据集：${ds.name}（${ds.kind === "panel" ? "面板" : "问卷"}）`);
  lines.push(`实体列：${ds.entityKey}${ds.timeKey ? `；时间列：${ds.timeKey}` : ""}${ds.groupKey ? `；分组列：${ds.groupKey}` : ""}`);
  lines.push("");
  lines.push("## 层级");
  lines.push("");
  lines.push("```");
  lines.push(ds.goalName);
  for (const dim of ds.dimensions) {
    const members = ds.indicators.filter((i) => i.dimensionId === dim.id);
    lines.push(`├─ ${dim.name}  ${fmtPct(dim.weight, 0)}`);
    members.forEach((ind, i) => {
      const last = i === members.length - 1;
      const mark = ind.selected ? "" : " [未纳入]";
      lines.push(
        `│  ${last ? "└" : "├"}─ ${ind.name}${ind.unit ? ` (${ind.unit})` : ""}  ${ind.direction === 1 ? "+" : "−"}${mark}`,
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
      `| ${ind.key} | ${ind.name} | ${ind.unit ?? "—"} | ${ind.direction === 1 ? "正向" : "负向"} | ${dim} | ${ind.selected ? "是" : "否"} |`,
    );
  }
  lines.push("");
  if (ds.indicators.some((i) => i.note)) {
    lines.push("## 备注");
    for (const ind of ds.indicators) {
      if (ind.note) lines.push(`- ${ind.name}：${ind.note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
