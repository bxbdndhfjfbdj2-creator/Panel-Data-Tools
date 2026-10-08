import { useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  computeScores,
  computeWeights,
  crossMethodAnalysis,
  groupMeans,
  indicatorContributions,
  leaveOneOutInfluence,
  meanByEntity,
  rankForYear,
  reliability,
  screenDataset,
} from "@/lib/engine";
import { bootstrapIntervals, yearStability } from "@/lib/diagnose";
import { buildRScript, buildStataDo } from "@/lib/scripts";
import { displayLabel } from "@/lib/catalog";
import { toCsv } from "@/lib/csv";
import { downloadBlob } from "@/lib/persist";
import { buildMarkdownReport, nextExportFilename } from "@/lib/report";
import { actualLatestYear, buildAnalysisContext, resultPeriodLabel } from "@/lib/slice";
import { useStudio } from "@/lib/store";
import { METHOD_META, type AggMethod } from "@/lib/types";
import { cn, fmt } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { SelectNative } from "./ui/select-native";
import { ClientOnly } from "./client-only";

const DIM_COLORS = [
  "var(--color-accent)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
];

export function ResultsPanel() {
  const full = useStudio((s) => s.dataset);
  const method = useStudio((s) => s.method);
  const standardize = useStudio((s) => s.standardize);
  const missingMode = useStudio((s) => s.missingMode);
  const transform = useStudio((s) => s.transform);
  const thresholds = useStudio((s) => s.thresholds);
  const yearFrom = useStudio((s) => s.yearFrom);
  const yearTo = useStudio((s) => s.yearTo);
  const resultYear = useStudio((s) => s.resultYear);
  const setResultYear = useStudio((s) => s.setResultYear);
  const resultMode = useStudio((s) => s.resultMode);
  const setResultMode = useStudio((s) => s.setResultMode);
  const focusEntity = useStudio((s) => s.focusEntity);
  const setFocusEntity = useStudio((s) => s.setFocusEntity);
  const context = useMemo(
    () => buildAnalysisContext(full, yearFrom, yearTo, resultMode, resultYear),
    [full, yearFrom, yearTo, resultMode, resultYear],
  );
  const ds = context.dataset;
  const view = context.view;

  const weights = useMemo(
    () => computeWeights(ds, method, missingMode, transform),
    [ds, method, missingMode, transform],
  );
  const bundle = useMemo(
    () => computeScores(ds, weights, standardize, method, missingMode, transform),
    [ds, weights, standardize, method, missingMode, transform],
  );
  const rel = useMemo(() => reliability(ds, transform), [ds, transform]);
  const screen = useMemo(() => screenDataset(ds, thresholds, transform), [ds, thresholds, transform]);
  const years = context.actualYears;

  const ranking = useMemo(() => {
    if (ds.kind !== "panel") return [...bundle.rows].sort((a, b) => b.composite - a.composite);
    if (view.mode === "mean") return meanByEntity(bundle.rows);
    return rankForYear(bundle.rows, view.mode === "year" ? view.year : null);
  }, [bundle.rows, ds.kind, view]);

  const ci = useMemo(
    () =>
      bootstrapIntervals(
        ds,
        weights,
        standardize,
        method,
        missingMode,
        transform,
        ranking.slice(0, 24).map((r) => r.entity),
        36,
        2026,
        view,
      ),
    [ds, weights, standardize, method, missingMode, transform, ranking, view],
  );
  const stab = useMemo(
    () => yearStability(ds, weights, standardize, method, missingMode, transform),
    [ds, weights, standardize, method, missingMode, transform],
  );

  const groups = useMemo(() => groupMeans(ranking), [ranking]);
  const entity =
    focusEntity && ranking.some((r) => r.entity === focusEntity)
      ? focusEntity
      : ranking[0]?.entity ?? null;

  const radar = useMemo(() => {
    const row = ranking.find((r) => r.entity === entity);
    if (!row) return [];
    return ds.dimensions.map((d) => ({
      dim: d.name,
      v: Math.round((row.dims[d.id] ?? 0) * 10) / 10,
    }));
  }, [ranking, entity, ds.dimensions]);

  const contrib = useMemo(() => {
    const row = ranking.find((r) => r.entity === entity);
    if (!row || method === "topsis" || method === "median" || method === "trimmed") return [];
    return indicatorContributions(ds, weights, row);
  }, [ranking, entity, ds, weights, method]);

  const series = useMemo(() => {
    if (ds.kind !== "panel" || !entity) return [];
    return bundle.rows
      .filter((r) => r.entity === entity)
      .sort((a, b) => a.time == null ? (b.time == null ? 0 : 1) : b.time == null ? -1 : a.time - b.time)
      .map((r) => ({
        year: r.time,
        综合: Math.round(r.composite * 10) / 10,
        ...Object.fromEntries(
          ds.dimensions.map((d) => [d.name, Math.round((r.dims[d.id] ?? 0) * 10) / 10]),
        ),
      }));
  }, [bundle.rows, entity, ds]);

  const cross = useMemo(
    () => crossMethodAnalysis(ds, standardize, undefined, missingMode, transform, view),
    [ds, standardize, missingMode, transform, view],
  );

  const influence = useMemo(
    () => leaveOneOutInfluence(ds, method, standardize, missingMode, transform, view),
    [ds, method, standardize, missingMode, transform, view],
  );

  const heat = useMemo(() => {
    const top = ranking.slice(0, 12);
    return top.map((r) => ({
      entity: r.entity,
      composite: r.composite,
      dims: ds.dimensions.map((d) => r.dims[d.id] ?? 0),
    }));
  }, [ranking, ds.dimensions]);

  const [tab, setTab] = useState<"rank" | "group">("rank");

  const meanC = ranking.length
    ? ranking.reduce((a, r) => a + r.composite, 0) / ranking.length
    : NaN;
  const maxC = ranking[0]?.composite ?? NaN;
  const minC = ranking[ranking.length - 1]?.composite ?? NaN;
  const heatScale = Math.max(
    1,
    ...heat.flatMap((r) => [r.composite, ...r.dims]),
  );
  const subscaleAlphas = Object.values(rel.byDim);
  const alphaShow = subscaleAlphas.length
    ? subscaleAlphas.reduce((a, b) => a + b, 0) / subscaleAlphas.length
    : rel.overall;

  function exportCsv() {
    const headers = [
      ds.entityKey,
      ...(ds.timeKey ? [ds.timeKey] : []),
      "综合指数",
      ...ds.dimensions.map((d) => d.name),
    ];
    const rows = ranking.map((r) => ({
      [ds.entityKey]: r.entity,
      ...(ds.timeKey ? { [ds.timeKey]: r.time } : {}),
      综合指数: Math.round(r.composite * 100) / 100,
      ...Object.fromEntries(ds.dimensions.map((d) => [d.name, Math.round((r.dims[d.id] ?? 0) * 100) / 100])),
    }));
    downloadBlob(nextExportFilename(`${ds.goalName}-scores`, "csv"), toCsv(headers, rows), "text/csv");
    toast.success("已导出综合得分");
  }

  function exportReport() {
    const md = buildMarkdownReport({
      dataset: ds,
      sourceDataset: full,
      method,
      standardize,
      missingMode,
      transform,
      yearFrom,
      yearTo,
      screen,
      weights,
      ranking,
      kmo: bundle.kmo,
      dropped: bundle.dropped,
      alpha: rel.overall,
      view,
      sensitivity: ci,
      stability: stab,
      crossMethod: cross,
      influence,
    });
    downloadBlob(nextExportFilename(`${ds.goalName}-报告`, "md"), md, "text/markdown");
    toast.success("已导出方法报告");
  }

  function exportScripts() {
    downloadBlob(
      nextExportFilename(`${ds.goalName}-草图`, "do"),
      buildStataDo(ds, method, standardize, missingMode, transform),
      "text/plain",
    );
    downloadBlob(
      nextExportFilename(`${ds.goalName}-草图`, "R"),
      buildRScript(ds, method, standardize, missingMode, transform),
      "text/plain",
    );
    toast.success("已导出 Stata 与 R 草图");
  }

  return (
    <div className="stagger-in space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest text-muted uppercase">输出</p>
          <h2 className="font-display mt-1 text-2xl font-medium sm:text-3xl">{ds.goalName}</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {METHOD_META[method].label} · {method === "topsis" ? "TOPSIS 方向调整极差标准化" : standardize === "minmax" ? "极差标准化" : "Z 分数"}
            {missingMode === "mean" ? " · 均值填补" : missingMode === "pairwise" ? " · 可用指标" : ""}
            {panelRankHint(ds.kind, view.mode === "mean" ? "mean" : "latest", view.year)}
            {ds.kind === "panel" && view.mode === "latest" ? ` · 最新实际年份 ${actualLatestYear(ds) ?? "无有效年份"}` : ""}
            {` · 当前窗口 ${context.observations} 条 / ${context.entities} 个实体`}
            {bundle.dropped ? ` · 因缺失删除 ${bundle.dropped} 条` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ds.kind === "panel" && years.length > 0 && (
            <SelectNative
              className="h-10 w-36"
              value={view.mode === "mean" ? "mean" : view.mode === "year" ? String(view.year) : ""}
              onChange={(e) => {
                if (e.target.value === "mean") setResultMode("mean");
                else {
                  setResultMode("latest");
                  setResultYear(e.target.value ? Number(e.target.value) : null);
                }
              }}
            >
              <option value="">各实体最新观测</option>
              <option value="mean">时期均值</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </SelectNative>
          )}
          <Button variant="secondary" onClick={exportReport}>
            <FileText />
            导出报告
          </Button>
          <Button variant="secondary" onClick={exportScripts}>
            <FileText />
            Stata/R
          </Button>
          <Button variant="secondary" onClick={exportCsv}>
            <Download />
            导出得分
          </Button>
        </div>
      </header>

      {(bundle.error || weights.error) && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{bundle.error ?? weights.error}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="样本 / 个体" value={String(ranking.length)} />
        <Kpi label="指数均值" value={fmt(meanC, 1)} />
        <Kpi label="极差" value={fmt(maxC - minC, 1)} />
        <Kpi
          label={ds.kind === "survey" ? (subscaleAlphas.length ? "分量表 α" : "Cronbach α") : "KMO"}
          value={ds.kind === "survey" ? fmt(alphaShow, 3) : fmt(bundle.kmo, 3)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="rounded-xl bg-surface p-4 shadow-border lg:col-span-3 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{rankHeading(ds.kind, view.mode === "mean" ? "mean" : "latest", view.year)}</h3>
            <span className="text-xs text-muted">当前窗口结果</span>
            {ds.groupKey && (
              <div className="flex rounded-md bg-bg p-0.5 text-xs">
                <button
                  type="button"
                  className={cn("min-h-8 rounded-sm px-2 py-1", tab === "rank" && "bg-surface shadow-border")}
                  onClick={() => setTab("rank")}
                >
                  个体
                </button>
                <button
                  type="button"
                  className={cn("min-h-8 rounded-sm px-2 py-1", tab === "group" && "bg-surface shadow-border")}
                  onClick={() => setTab("group")}
                >
                  分组
                </button>
              </div>
            )}
          </div>
          {tab === "group" ? (
            <GroupTable
              groups={groups}
              dimensions={ds.dimensions}
              label={(g) => displayLabel(ds.valueLabels, ds.groupKey, g)}
            />
          ) : (
            <RankTable
              rows={ranking}
              dimensions={ds.dimensions}
              kind={ds.kind}
              view={view}
              active={entity}
              onPick={setFocusEntity}
              max={maxC}
              ci={ci}
            />
          )}
        </section>

        <section className="rounded-xl bg-surface p-4 shadow-border lg:col-span-2 sm:p-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">维度剖面</h3>
            <SelectNative
              className="h-11 w-36 text-xs"
              value={entity ?? ""}
              onChange={(e) => setFocusEntity(e.target.value)}
            >
              {ranking.map((r) => (
                <option key={r.entity} value={r.entity}>
                  {r.entity}
                </option>
              ))}
            </SelectNative>
          </div>
          <p className="mb-2 text-xs text-muted">{method === "topsis" ? "维度分数按方向调整后的极差标准化显示为 0–100；综合指数是 TOPSIS 贴近度换算到 0–100，二者不可加总。" : standardize === "zscore" ? "每个维度与综合指数分别映射为均分 50、标准差 10；维度值不能直接相加还原综合指数。" : "维度与综合指数均以 0–100 显示，维度按维度权重合成综合指数。"}</p>
          <div className="h-64">
            <ClientOnly fallback={<div className="h-full rounded-md bg-bg-subtle" />}>
              <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radar}>
                <PolarGrid stroke="var(--color-border)" />
                <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
                <PolarRadiusAxis tick={{ fontSize: 10, fill: "var(--color-subtle)" }} />
                <Radar dataKey="v" stroke="var(--color-accent)" fill="var(--color-accent)" fillOpacity={0.18} />
                <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
            </ClientOnly>
          </div>
        </section>
      </div>

      <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
        <h3 className="text-sm font-medium">重抽样敏感性范围</h3>
        <p className="mt-1 text-xs text-muted">
          seed {ci.seed} · 请求 B={ci.requestedB} · 有效 B={ci.effectiveB}。这是重抽样敏感性范围，不是完整置信区间。
          {ci.status === "disabled" ? ` 当前停用：${sensitivityReason(ci.reason)}。` : ""}
        </p>
      </section>

      {contrib.length > 0 && (
        <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
          <h3 className="text-sm font-medium">{entity} · 指标贡献</h3>
          <p className="mt-1 text-xs text-muted">
            所列贡献与截距相加等于当前综合指数。正值推高综合指数。
          </p>
          <p className="mt-1 text-xs text-muted">截距 {fmt(ranking.find((r) => r.entity === entity)?.contributionIntercept ?? 0, 2)}</p>
          <div className="mt-3 h-56">
            <ClientOnly fallback={<div className="h-full rounded-md bg-bg-subtle" />}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={contrib.map((c) => ({
                    name: c.name.length > 10 ? c.name.slice(0, 10) + "…" : c.name,
                    full: c.name,
                    贡献: Math.round(c.contrib * 10) / 10,
                  }))}
                  layout="vertical"
                  margin={{ top: 4, right: 12, left: 8, bottom: 4 }}
                >
                  <CartesianGrid stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-muted)" }} />
                  <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 10, fill: "var(--color-muted)" }} />
                  <Tooltip
                    formatter={(v) => [fmt(Number(v), 1), "贡献"]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ""}
                    contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="贡献" fill="var(--color-accent)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ClientOnly>
          </div>
        </section>
      )}

      {ds.kind === "panel" && series.length > 1 && (
        <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
          <h3 className="text-sm font-medium">{entity} · 时期轨迹</h3>
          <div className="mt-3 h-56">
            <ClientOnly fallback={<div className="h-full rounded-md bg-bg-subtle" />}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
                <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="综合" stroke="var(--color-accent)" strokeWidth={2} dot={false} />
                {ds.dimensions.map((d, i) => (
                  <Line
                    key={d.id}
                    type="monotone"
                    dataKey={d.name}
                    stroke={DIM_COLORS[i % DIM_COLORS.length]}
                    strokeWidth={1.25}
                    dot={false}
                    strokeDasharray="4 3"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            </ClientOnly>
          </div>
        </section>
      )}

      <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
        <h3 className="text-sm font-medium">维度热力（前 {heat.length}）</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-medium text-muted"> </th>
                {ds.dimensions.map((d) => (
                  <th key={d.id} className="px-2 py-1 font-medium text-muted">{d.name}</th>
                ))}
                <th className="px-2 py-1 font-medium text-muted">综合</th>
              </tr>
            </thead>
            <tbody>
              {heat.map((r) => (
                <tr key={r.entity}>
                  <td className="px-2 py-1 whitespace-nowrap">{r.entity}</td>
                  {r.dims.map((v, i) => (
                    <td key={i} className="px-1 py-1">
                      <HeatCell value={v} max={heatScale} />
                    </td>
                  ))}
                  <td className="px-2 py-1 tabular font-medium">{fmt(r.composite, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
        <h3 className="text-sm font-medium">方法对照 · 名次</h3>
        <p className="mt-1 text-xs text-muted">
          同一批个体在可用客观赋权方法下的名次。名次越接近，结论越不依赖单一方法。
        </p>
        {Object.entries(cross.skipped).map(([m, reason]) => <p key={m} className="mt-1 text-xs text-muted">{METHOD_META[m as AggMethod].short} 已跳过：{reason}</p>)}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="px-2 py-2 font-medium">名称</th>
                {cross.methods.map((m) => (
                  <th key={m} className="px-2 py-2 font-medium tabular">
                    {METHOD_META[m].short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cross.entities.slice(0, 12).map((e) => (
                <tr key={e} className="border-b border-border/60">
                  <td className="px-2 py-2 font-medium">{e}</td>
                  {cross.methods.map((m) => (
                    <td key={m} className="px-2 py-2 tabular">
                      {cross.ranks[m]?.[e] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
          <h3 className="text-sm font-medium">方法稳健性 · Spearman ρ</h3>
          <p className="mt-1 text-xs text-muted">秩相关越接近 1，名次越不随方法改动。</p>
          <ul className="mt-3 max-h-64 divide-y divide-border overflow-auto">
            {cross.spearman.map((x) => (
              <li key={x.a + x.b} className="flex items-center justify-between py-2 text-sm">
                <span className="text-muted">
                  {METHOD_META[x.a as AggMethod].short} · {METHOD_META[x.b as AggMethod].short}
                </span>
                <span className="tabular font-medium">{fmt(x.rho, 3)}</span>
              </li>
            ))}
          </ul>
        </section>
        {ds.groupKey ? (
          <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
            <h3 className="text-sm font-medium">分组对照</h3>
            <div className="mt-3 h-56">
              <ClientOnly fallback={<div className="h-full rounded-md bg-bg-subtle" />}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={groups.map((g) => ({ name: g.group, 指数: Math.round(g.composite * 10) / 10 }))}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
                  <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="指数" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </ClientOnly>
            </div>
          </section>
        ) : null}
      </div>

      {ds.kind === "survey" && Object.keys(rel.byDim).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {ds.dimensions.map((d) =>
            rel.byDim[d.id] != null ? (
              <Badge key={d.id} variant="muted">
                {d.name} α {fmt(rel.byDim[d.id]!, 3)}
              </Badge>
            ) : null,
          )}
        </div>
      )}

      {stab && stab.rho.length > 0 && (
        <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
          <h3 className="text-sm font-medium">时间稳健 · 与最新年秩相关</h3>
          <p className="mt-1 text-xs text-muted">
            固定当前窗口权重，按年重算得分。平均 ρ {fmt(stab.meanRho, 3)}。接近 1 说明名次不随年份剧烈跳动。
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {stab.rho.map((x) => (
              <li key={x.year} className="flex items-center justify-between rounded-md bg-bg px-3 py-2 text-sm">
                <span className="text-muted">{x.year}</span>
                <span className="tabular font-medium">{fmt(x.rho, 3)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {influence.length > 0 && (
        <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
          <h3 className="text-sm font-medium">留一法影响</h3>
          <p className="mt-1 text-xs text-muted">
            剔除该指标后，综合得分与原结果的 Spearman ρ。越低说明该指标对排序越关键。
          </p>
          <ul className="mt-3 divide-y divide-border">
            {influence.map((x) => (
              <li key={x.key} className="flex items-center justify-between py-2 text-sm">
                <span>{x.name}</span>
                <span className="tabular font-medium">{fmt(x.rho, 3)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3 shadow-border">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-display mt-1 text-2xl tabular font-medium">{value}</div>
    </div>
  );
}

function panelRankHint(kind: string, mode: "latest" | "mean", year: number | null) {
  if (kind !== "panel") return "";
  if (mode === "mean") return " · 个体时期均值排名";
  if (year != null) return ` · ${year} 年排名`;
  return " · 各实体取最新实际观测";
}

function rankHeading(kind: string, mode: "latest" | "mean", year: number | null) {
  if (kind !== "panel") return "个体得分";
  if (mode === "mean") return "时期均值排名";
  if (year != null) return `${year} 年排名`;
  return "各实体最新观测排名";
}

function sensitivityReason(reason: string | undefined) {
  if (reason === "too_few_entities") return "所选结果少于 6 个实体";
  if (reason === "too_many_rows") return "观测数超过 3500 行规模上限";
  if (reason === "invalid_repetitions") return "重复次数无效";
  if (reason === "no_valid_repetitions") return "没有有效重抽样";
  return "未计算";
}

function bandText(ci: Record<string, { lo: number; hi: number }>, entity: string) {
  const band = ci[entity];
  if (!band) return "—";
  return `${fmt(band.lo, 0)}-${fmt(band.hi, 0)}`;
}

function RankTable({
  rows,
  dimensions,
  kind,
  view,
  active,
  onPick,
  max,
  ci,
}: {
  rows: { entity: string; composite: number; group: string | null; time: number | null }[];
  dimensions: { id: string; name: string }[];
  kind: "panel" | "survey";
  view: { mode: "latest" | "mean" | "year"; year: number | null };
  active: string | null;
  onPick: (e: string) => void;
  max: number;
  ci: { ranges: Record<string, { lo: number; hi: number }>; effectiveB: number };
}) {
  return (
    <div className="max-h-96 overflow-auto">
      <table className="min-w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-muted">
            <th className="px-2 py-2 font-medium">#</th>
            <th className="px-2 py-2 font-medium">名称</th>
            <th className="px-2 py-2 font-medium">指数</th>
            <th className="hidden px-2 py-2 font-medium md:table-cell">敏感性范围</th>
            <th className="hidden px-2 py-2 font-medium sm:table-cell">分布</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.entity + String(r.time)}
              className={cn(
                "cursor-pointer border-b border-border/60",
                active === r.entity && "bg-accent-soft",
              )}
              onClick={() => onPick(r.entity)}
            >
              <td className="px-2 py-2 tabular text-subtle">{i + 1}</td>
              <td className="px-2 py-2">
                <div className="font-medium">{r.entity}</div>
                {r.group && <div className="text-2xs text-subtle">{r.group}</div>}
                <div className="text-2xs text-muted">{resultPeriodLabel(kind, view, r.time)}</div>
              </td>
              <td className="px-2 py-2 tabular font-medium">{fmt(r.composite, 1)}</td>
              <td className="hidden px-2 py-2 tabular text-muted md:table-cell">
                {bandText(ci.ranges, r.entity)}
              </td>
              <td className="hidden px-2 py-2 sm:table-cell">
                <div className="h-1.5 w-full rounded-full bg-bg-subtle">
                  <div
                    className="h-1.5 rounded-full bg-accent"
                    style={{ width: `${max ? (r.composite / max) * 100 : 0}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sr-only">{dimensions.map((d) => d.name).join("、")}</p>
    </div>
  );
}

function GroupTable({
  groups,
  dimensions,
  label,
}: {
  groups: { group: string; n: number; nEff: number; composite: number; dims: Record<string, number>; weighted: boolean }[];
  dimensions: { id: string; name: string }[];
  label: (g: string) => string;
}) {
  const weighted = groups.some((g) => g.weighted);
  return (
    <table className="min-w-full text-left text-xs">
      <thead>
        <tr className="border-b border-border text-muted">
          <th className="px-2 py-2 font-medium">分组</th>
          <th className="px-2 py-2 font-medium">n</th>
          {weighted && <th className="px-2 py-2 font-medium">n<sub>eff</sub></th>}
          <th className="px-2 py-2 font-medium">{weighted ? "加权综合" : "综合"}</th>
          {dimensions.map((d) => (
            <th key={d.id} className="hidden px-2 py-2 font-medium md:table-cell">{d.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.group} className="border-b border-border/60">
            <td className="px-2 py-2 font-medium">{label(g.group)}</td>
            <td className="px-2 py-2 tabular">{g.n}</td>
            {weighted && <td className="px-2 py-2 tabular">{fmt(g.nEff, 1)}</td>}
            <td className="px-2 py-2 tabular">{fmt(g.composite, 1)}</td>
            {dimensions.map((d) => (
              <td key={d.id} className="hidden px-2 py-2 tabular md:table-cell">
                {fmt(g.dims[d.id], 1)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HeatCell({ value, max }: { value: number; max: number }) {
  const t = Math.max(0, Math.min(1, value / max));
  const bg = `color-mix(in oklab, var(--color-accent) ${Math.round(t * 72)}%, var(--color-bg-subtle))`;
  return (
    <div
      className="rounded-sm px-2 py-1 text-center tabular text-2xs"
      style={{ background: bg, color: t > 0.55 ? "var(--color-accent-fg)" : "var(--color-fg)" }}
    >
      {fmt(value, 0)}
    </div>
  );
}
