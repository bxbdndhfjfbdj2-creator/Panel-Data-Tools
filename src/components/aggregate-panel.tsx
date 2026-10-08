import { useMemo } from "react";
import { useSlicedDataset, useStudio } from "@/lib/store";
import { computeWeights, reliability } from "@/lib/engine";
import { METHOD_META, type AggMethod, type LogMode, type WinsorTail } from "@/lib/types";
import { cn, fmt, fmtPct } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Slider } from "./ui/slider";
import { ClientOnly } from "./client-only";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const METHODS: AggMethod[] = ["equal", "entropy", "cv", "critic", "pca", "topsis", "custom"];

export function AggregatePanel() {
  const ds = useSlicedDataset();
  const full = useStudio((s) => s.dataset);
  const method = useStudio((s) => s.method);
  const standardize = useStudio((s) => s.standardize);
  const missingMode = useStudio((s) => s.missingMode);
  const transform = useStudio((s) => s.transform);
  const setMethod = useStudio((s) => s.setMethod);
  const setStandardize = useStudio((s) => s.setStandardize);
  const setMissingMode = useStudio((s) => s.setMissingMode);
  const setTransform = useStudio((s) => s.setTransform);
  const setIndicatorWeight = useStudio((s) => s.setIndicatorWeight);
  const normalizeLeafWeights = useStudio((s) => s.normalizeLeafWeights);
  const setStep = useStudio((s) => s.setStep);

  const weights = useMemo(
    () => computeWeights({ ...full, rows: ds.rows }, method, missingMode, transform),
    [full, ds.rows, method, missingMode, transform],
  );
  const rel = useMemo(() => reliability({ ...full, rows: ds.rows }), [full, ds.rows]);

  const chartData = full.indicators
    .filter((i) => i.selected && i.dimensionId)
    .map((i) => ({
      name: i.name.length > 10 ? i.name.slice(0, 10) + "…" : i.name,
      full: i.name,
      w: Math.round((weights.indicator[i.key] ?? 0) * 1000) / 10,
    }));

  return (
    <div className="stagger-in space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest text-muted uppercase">赋权</p>
          <h2 className="font-display mt-1 text-2xl font-medium sm:text-3xl">聚合方法</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            先在维度内对指标赋权，再按准则层权重合成目标层。维度权重可在体系步用滑块或 AHP 设定。负向指标在标准化阶段取反。
          </p>
        </div>
        <Button onClick={() => setStep("results")}>查看结果</Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {METHODS.map((m) => {
          const meta = METHOD_META[m];
          const active = method === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={cn(
                "min-h-11 rounded-xl p-4 text-left transition-[box-shadow,background-color] duration-[var(--motion-quick)]",
                active ? "bg-accent text-accent-fg shadow-border" : "bg-surface shadow-border hover:shadow-[var(--shadow-border-hover)]",
              )}
            >
              <div className="text-sm font-medium">{meta.label}</div>
              <p className={cn("mt-2 text-xs leading-relaxed", active ? "text-accent-fg/75" : "text-muted")}>
                {meta.blurb}
              </p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">指标权重</h3>
            {weights.pcaVariance != null && (
              <Badge variant="muted">第一主成分解释 {fmtPct(weights.pcaVariance)}</Badge>
            )}
          </div>
          <div className="mt-4 h-64">
            <ClientOnly fallback={<div className="h-full rounded-md bg-bg-subtle" />}>
              <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 12, left: 8, bottom: 4 }}
              >
                <CartesianGrid stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-muted)" }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={88}
                  tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                />
                <Tooltip
                  formatter={(v) => [`${fmt(Number(v), 1)}%`, "权重"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ""}
                  contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="w" fill="var(--color-accent)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            </ClientOnly>
          </div>
          {weights.notes.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {weights.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl bg-surface p-4 shadow-border">
          <h3 className="text-sm font-medium">标准化</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setStandardize("minmax")}
              className={cn(
                "min-h-11 rounded-md px-3 py-2 text-xs font-medium shadow-border",
                standardize === "minmax" ? "bg-accent text-accent-fg" : "bg-bg",
              )}
            >
              极差
            </button>
            <button
              type="button"
              onClick={() => setStandardize("zscore")}
              className={cn(
                "min-h-11 rounded-md px-3 py-2 text-xs font-medium shadow-border",
                standardize === "zscore" ? "bg-accent text-accent-fg" : "bg-bg",
              )}
            >
              Z 分数
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {standardize === "minmax"
              ? "映射到 [0,1]，负向指标取 1−x。合成后乘 100。"
              : "按样本均值与标准差中心化，负向取反。合成为均分 50、标准差 10 的指数。"}
          </p>
          <h3 className="mt-5 text-sm font-medium">缺失处理</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setMissingMode("listwise")}
              className={cn(
                "min-h-11 rounded-md px-3 py-2 text-xs font-medium shadow-border",
                missingMode === "listwise" ? "bg-accent text-accent-fg" : "bg-bg",
              )}
            >
              整行删除
            </button>
            <button
              type="button"
              onClick={() => setMissingMode("mean")}
              className={cn(
                "min-h-11 rounded-md px-3 py-2 text-xs font-medium shadow-border",
                missingMode === "mean" ? "bg-accent text-accent-fg" : "bg-bg",
              )}
            >
              均值填补
            </button>
            <button
              type="button"
              onClick={() => setMissingMode("pairwise")}
              className={cn(
                "min-h-11 rounded-md px-3 py-2 text-xs font-medium shadow-border",
                missingMode === "pairwise" ? "bg-accent text-accent-fg" : "bg-bg",
              )}
            >
              可用指标
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {missingMode === "listwise"
              ? "任一纳入指标缺失则整行剔除。"
              : missingMode === "mean"
                ? "按列均值填补后再赋权与合成，保留更多观测。"
                : "赋权仍用列均值填补；合成时每行只用已观测指标并重标权重，至少一半指标有值才计分。"}
          </p>
          <h3 className="mt-5 text-sm font-medium">缩尾</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {([
              [0, "无"],
              [0.01, "1% / 99%"],
              [0.05, "5% / 95%"],
            ] as [WinsorTail, string][]).map(([v, lab]) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setTransform({ winsor: v })}
                className={cn(
                  "min-h-11 rounded-md px-2 py-2 text-xs font-medium shadow-border",
                  transform.winsor === v ? "bg-accent text-accent-fg" : "bg-bg",
                )}
              >
                {lab}
              </button>
            ))}
          </div>
          <h3 className="mt-5 text-sm font-medium">对数变换</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {([
              ["off", "无"],
              ["ln", "ln(x)"],
              ["log1p", "ln(1+x)"],
            ] as [LogMode, string][]).map(([v, lab]) => (
              <button
                key={v}
                type="button"
                onClick={() => setTransform({ logMode: v })}
                className={cn(
                  "min-h-11 rounded-md px-2 py-2 text-xs font-medium shadow-border",
                  transform.logMode === v ? "bg-accent text-accent-fg" : "bg-bg",
                )}
              >
                {lab}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            先缩尾再取对数，再进入标准化与赋权。ln 要求自变量为正，ln(1+x) 要求非负；若某列超过三成非正，该列跳过对数以免大量变缺失。收入、产值类指标适合变换，李克特题请保持「无」。
          </p>
          {ds.kind === "survey" && rel.overall != null && (
            <div className="mt-4 rounded-md bg-bg px-3 py-2">
              <div className="text-xs text-muted">Cronbach α</div>
              <div className="font-display text-xl tabular">{fmt(rel.overall, 3)}</div>
            </div>
          )}
        </section>
      </div>

      {method === "custom" && (
        <section className="space-y-4">
          {full.dimensions.map((dim) => {
            const members = full.indicators.filter((i) => i.selected && i.dimensionId === dim.id);
            if (!members.length) return null;
            return (
              <div key={dim.id} className="rounded-xl bg-surface p-4 shadow-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">{dim.name}</h3>
                  <Button variant="ghost" size="sm" onClick={() => normalizeLeafWeights(dim.id)}>
                    归一
                  </Button>
                </div>
                <div className="mt-3 space-y-3">
                  {members.map((ind) => (
                    <div key={ind.key}>
                      <div className="flex justify-between text-xs">
                        <span>{ind.name}</span>
                        <span className="tabular">{fmt(ind.weight, 2)}</span>
                      </div>
                      <Slider
                        min={0}
                        max={100}
                        step={1}
                        value={[ind.weight * 100]}
                        onValueChange={(v) => setIndicatorWeight(ind.key, (v[0] ?? 0) / 100)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="overflow-hidden rounded-xl bg-surface shadow-border">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-bg-elevated text-muted">
              <th className="px-3 py-2 font-medium">维度</th>
              <th className="px-3 py-2 font-medium">指标</th>
              <th className="px-3 py-2 font-medium">方向</th>
              <th className="px-3 py-2 font-medium tabular">维内权重</th>
              <th className="px-3 py-2 font-medium tabular">全局贡献</th>
            </tr>
          </thead>
          <tbody>
            {full.dimensions.flatMap((dim) =>
              full.indicators
                .filter((i) => i.selected && i.dimensionId === dim.id)
                .map((ind) => {
                  const lw = weights.indicator[ind.key] ?? 0;
                  const gw = lw * (weights.dimension[dim.id] ?? 0);
                  return (
                    <tr key={ind.key} className="border-b border-border/70">
                      <td className="px-3 py-2">{dim.name}</td>
                      <td className="px-3 py-2 font-medium">{ind.name}</td>
                      <td className="px-3 py-2">{ind.direction === 1 ? "正向" : "负向"}</td>
                      <td className="px-3 py-2 tabular">{fmtPct(lw)}</td>
                      <td className="px-3 py-2 tabular">{fmtPct(gw)}</td>
                    </tr>
                  );
                }),
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
