import type { AggMethod, Dataset, MissingMode, Standardize, TransformSpec } from "./types";
import { METHOD_META } from "./types";

function stataName(s: string, i: number): string {
  const t = s.replace(/[^\w]/g, "_").replace(/^(\d)/, "_$1").slice(0, 28);
  return t || `v${i + 1}`;
}

export function buildStataDo(
  ds: Dataset,
  method: AggMethod,
  standardize: Standardize,
  missing: MissingMode,
  tx: TransformSpec,
): string {
  const selected = ds.indicators.filter((i) => i.selected && i.dimensionId);
  const lines: string[] = [
    "* 衡策导出 · 可复现草图，非完整复制 CRITIC/熵权数值",
    `* 目标：${ds.goalName}`,
    `* 方法：${METHOD_META[method].label} · ${standardize} · ${missing}`,
    tx.winsor ? `* 缩尾 ${tx.winsor}` : "",
    tx.logMode !== "off" ? `* 对数 ${tx.logMode}` : "",
    ds.weightKey ? `* 抽样权重 ${ds.weightKey}` : "",
    "",
    "clear all",
    "* use \"yourdata.dta\", clear",
    "",
  ];
  selected.forEach((ind, i) => {
    const v = stataName(ind.key, i);
    lines.push(`* ${ind.name} (${ind.key})`);
    if (v !== ind.key) lines.push(`capture rename ${ind.key} ${v}`);
    if (ind.direction === -1) lines.push(`replace ${v} = -${v}`);
  });
  lines.push("");
  if (tx.winsor > 0) {
    const p = Math.round(tx.winsor * 100);
    lines.push(`* winsor2, cuts(${p} ${100 - p}) replace`);
  }
  if (tx.logMode === "ln") lines.push("* foreach v of varlist ... : replace `v' = ln(`v') if `v'>0");
  if (tx.logMode === "log1p") lines.push("* foreach v of varlist ... : replace `v' = ln(1+`v') if `v'>=0");
  lines.push("");
  for (const dim of ds.dimensions) {
    const mem = selected.filter((i) => i.dimensionId === dim.id);
    if (!mem.length) continue;
    const vs = mem.map((m, i) => stataName(m.key, i)).join(" ");
    lines.push(`* 维度 ${dim.name} weight=${dim.weight.toFixed(3)} ${dim.measure ?? ""}`);
    lines.push(`alpha ${vs}`);
    lines.push(`egen dim_${stataName(dim.id, 0)} = rowmean(${vs})`);
    lines.push("");
  }
  const dimvs = ds.dimensions
    .filter((d) => selected.some((i) => i.dimensionId === d.id))
    .map((d) => `dim_${stataName(d.id, 0)}`)
    .join(" ");
  if (dimvs) {
    lines.push(`egen index = rowmean(${dimvs})`);
    lines.push("egen rank = rank(-index)");
    if (ds.groupKey) lines.push(`table ${ds.groupKey}, stat(mean index)`);
  }
  lines.push("");
  lines.push("* 客观赋权请对照衡策结果页权重表，或用 pca / factormat 自行估计。");
  return lines.filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");
}

export function buildRScript(
  ds: Dataset,
  method: AggMethod,
  standardize: Standardize,
  missing: MissingMode,
  tx: TransformSpec,
): string {
  const selected = ds.indicators.filter((i) => i.selected && i.dimensionId);
  const keys = selected.map((i) => i.key);
  const lines: string[] = [
    "# 衡策导出 · 可复现草图",
    `# 目标：${ds.goalName} · ${METHOD_META[method].label}`,
    `# 标准化 ${standardize} · 缺失 ${missing}`,
    "d <- read.csv('yourdata.csv', check.names = FALSE)",
    `keys <- c(${keys.map((k) => JSON.stringify(k)).join(", ")})`,
    "",
  ];
  for (const ind of selected) {
    if (ind.direction === -1) lines.push(`d[[${JSON.stringify(ind.key)}]] <- -d[[${JSON.stringify(ind.key)}]]`);
  }
  if (tx.logMode === "ln") lines.push("d[keys] <- lapply(d[keys], function(x) ifelse(x > 0, log(x), NA))");
  if (tx.logMode === "log1p") lines.push("d[keys] <- lapply(d[keys], function(x) ifelse(x >= 0, log1p(x), NA))");
  lines.push("");
  for (const dim of ds.dimensions) {
    const mem = selected.filter((i) => i.dimensionId === dim.id).map((m) => m.key);
    if (!mem.length) continue;
    const vec = `c(${mem.map((k) => JSON.stringify(k)).join(", ")})`;
    lines.push(`# ${dim.name}`);
    lines.push(`if (requireNamespace('psych', quietly=TRUE)) print(psych::alpha(d[, ${vec}, drop=FALSE])$total$raw_alpha)`);
    lines.push(`d[[${JSON.stringify("dim_" + dim.id)}]] <- rowMeans(d[, ${vec}, drop=FALSE], na.rm=TRUE)`);
  }
  const dimCols = ds.dimensions
    .filter((d) => selected.some((i) => i.dimensionId === d.id))
    .map((d) => JSON.stringify("dim_" + d.id));
  if (dimCols.length) {
    lines.push(`d$index <- rowMeans(d[, c(${dimCols.join(", ")}), drop=FALSE], na.rm=TRUE)`);
    lines.push("d$rank <- rank(-d$index, ties.method='average')");
  }
  if (ds.groupKey) lines.push(`aggregate(index ~ ${JSON.stringify(ds.groupKey)}, d, mean)`);
  lines.push("# 权重见表：衡策结果页。psych::principal 可对照主成分赋权。");
  return lines.join("\n");
}
