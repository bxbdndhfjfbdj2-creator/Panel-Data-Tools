import { useMemo } from "react";
import { useSlicedDataset, useStudio } from "@/lib/store";
import { screenDataset } from "@/lib/engine";
import { FLAG_LABEL } from "@/lib/types";
import { cn, fmt, fmtPct } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Slider } from "./ui/slider";
import { toast } from "sonner";
import { CorrHeat } from "./corr-heat";

export function ScreenPanel() {
  const ds = useSlicedDataset();
  const full = useStudio((s) => s.dataset);
  const th = useStudio((s) => s.thresholds);
  const heatSelectedOnly = useStudio((s) => s.heatSelectedOnly);
  const setHeatSelectedOnly = useStudio((s) => s.setHeatSelectedOnly);
  const setThreshold = useStudio((s) => s.setThreshold);
  const toggleIndicator = useStudio((s) => s.toggleIndicator);
  const applyScreening = useStudio((s) => s.applyScreening);
  const selectAllPass = useStudio((s) => s.selectAllPass);
  const setStep = useStudio((s) => s.setStep);
  const transform = useStudio((s) => s.transform);

  const rows = useMemo(() => screenDataset(ds, th, transform), [ds, th, transform]);
  const pass = rows.filter((r) => r.pass);
  const selected = full.indicators.filter((i) => i.selected).length;
  const heatKeys = heatSelectedOnly
    ? full.indicators.filter((i) => i.selected).map((i) => i.key)
    : undefined;

  return (
    <div className="stagger-in space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest text-muted uppercase">诊断</p>
          <h2 className="font-display mt-1 text-2xl font-medium sm:text-3xl">指标筛选</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            未归维指标用全局相关与 VIF；已归入反映性量表的高相关不再当错误，形成性维度则标维内冗余。维间高相关只提示、不剔除。
            {ds.kind === "panel" ? " 面板额外给出 ICC(1)。" : " 问卷检题总相关、地板 / 天花板与删题后 α。"}
            {ds.weightKey ? " 已启用抽样权重，均值、标准差与相关为加权估计。" : ""}
            {transform.winsor || transform.logMode !== "off" ? " 诊断基于聚合步所选的缩尾 / 对数变换后的取值。" : ""}
            {" 筛选候选集为当前数据集的全部指标；非阻断的维间相关与非线性提示仍显示为警告。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              applyScreening(rows.filter((r) => !r.pass).map((r) => r.key));
              toast.success("已取消勾选未通过指标");
            }}
          >
            剔除未通过
          </Button>
          <Button
            variant="secondary"
            onClick={() => selectAllPass(pass.map((r) => r.key))}
          >
            仅保留通过
          </Button>
          <Button onClick={() => setStep("system")}>进入体系</Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="通过" value={`${pass.length}/${rows.length}`} />
        <Stat label="已纳入" value={String(selected)} />
        <Stat
          label="最高 |r|"
          value={fmt(
            Math.max(0, ...rows.map((r) => (r.maxCorr ? Math.abs(r.maxCorr.r) : 0))),
            2,
          )}
        />
        <Stat
          label="最高 VIF"
          value={fmt(Math.max(0, ...rows.map((r) => r.vif ?? 0)), 1)}
        />
      </div>

      <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
        <h3 className="text-sm font-medium">阈值</h3>
        <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Thresh
            label="缺失率上限"
            value={fmtPct(th.maxMissing, 0)}
            min={0}
            max={40}
            v={th.maxMissing * 100}
            onChange={(v) => setThreshold({ maxMissing: v / 100 })}
          />
          <Thresh
            label="变异系数下限"
            value={fmt(th.minCv, 2)}
            min={0}
            max={20}
            v={th.minCv * 100}
            onChange={(v) => setThreshold({ minCv: v / 100 })}
          />
          <Thresh
            label="|相关| 上限"
            value={fmt(th.maxAbsCorr, 2)}
            min={50}
            max={99}
            v={th.maxAbsCorr * 100}
            onChange={(v) => setThreshold({ maxAbsCorr: v / 100 })}
          />
          <Thresh
            label="VIF 上限"
            value={fmt(th.maxVif, 0)}
            min={3}
            max={20}
            v={th.maxVif}
            onChange={(v) => setThreshold({ maxVif: v })}
          />
          {ds.kind === "survey" && (
            <>
              <Thresh
                label="题总相关下限"
                value={fmt(th.minItemTotal, 2)}
                min={10}
                max={60}
                v={th.minItemTotal * 100}
                onChange={(v) => setThreshold({ minItemTotal: v / 100 })}
              />
              <Thresh
                label="地板 / 天花板占比"
                value={fmtPct(th.maxFloorCeiling, 0)}
                min={20}
                max={80}
                v={th.maxFloorCeiling * 100}
                onChange={(v) => setThreshold({ maxFloorCeiling: v / 100 })}
              />
            </>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl bg-surface shadow-border">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-bg-elevated text-muted">
                <th className="px-3 py-2 font-medium">纳入</th>
                <th className="px-3 py-2 font-medium">指标</th>
                <th className="px-3 py-2 font-medium">判定</th>
                <th className="px-3 py-2 font-medium tabular">缺失</th>
                <th className="px-3 py-2 font-medium tabular">均值</th>
                <th className="px-3 py-2 font-medium tabular">SD</th>
                <th className="px-3 py-2 font-medium tabular">CV</th>
                <th className="px-3 py-2 font-medium tabular">VIF</th>
                <th className="px-3 py-2 font-medium">最大相关</th>
                {ds.kind === "survey" && (
                  <>
                    <th className="px-3 py-2 font-medium tabular">题总 r</th>
                    <th className="px-3 py-2 font-medium tabular">删后 α</th>
                  </>
                )}
                {ds.kind === "panel" && (
                  <th className="px-3 py-2 font-medium tabular">ICC</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const selected = full.indicators.find((i) => i.key === r.key)?.selected;
                return (
                  <tr key={r.key} className="border-b border-border/70 last:border-0">
                    <td className="px-3 py-2">
                      <label className="flex min-h-11 items-center">
                        <input
                          type="checkbox"
                          checked={!!selected}
                          onChange={(e) => toggleIndicator(r.key, e.target.checked)}
                          className="size-4 accent-accent"
                          aria-label={`纳入 ${r.name}`}
                        />
                      </label>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-fg">{r.name}</div>
                      <div className="text-2xs text-subtle">{r.key}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.pass && <Badge variant="ok">通过</Badge>}
                        {r.flags.map((f) => (
                          <Badge key={f} variant={f === "between_corr" || f === "nonlinear" || f === "high_corr" || f === "high_vif" ? "warn" : "danger"}>
                            {FLAG_LABEL[f]}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className={cn("px-3 py-2 tabular", r.missing > th.maxMissing && "text-danger")}>
                      {fmtPct(r.missing)}
                    </td>
                    <td className="px-3 py-2 tabular">{fmt(r.mean)}</td>
                    <td className="px-3 py-2 tabular">{fmt(r.sd)}</td>
                    <td className="px-3 py-2 tabular">{fmt(r.cv, 3)}</td>
                    <td className="px-3 py-2 tabular">{fmt(r.vif, 1)}</td>
                    <td className="px-3 py-2">
                      {r.maxCorr ? (
                        <span className="text-muted">
                          <span className="tabular text-fg">{fmt(r.maxCorr.r)}</span>
                          <span className="ml-1">{r.maxCorr.name}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {ds.kind === "survey" && (
                      <>
                        <td className="px-3 py-2 tabular">{fmt(r.itemTotal)}</td>
                        <td className="px-3 py-2 tabular">{fmt(r.alphaIfDeleted, 3)}</td>
                      </>
                    )}
                    {ds.kind === "panel" && (
                      <td className="px-3 py-2 tabular">{fmt(r.icc)}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          className="min-h-11 text-xs text-muted hover:text-fg"
          onClick={() => setHeatSelectedOnly(!heatSelectedOnly)}
        >
          {heatSelectedOnly ? "相关矩阵：仅已纳入" : "相关矩阵：全部指标"}
        </button>
      </div>
      <CorrHeat dataset={ds} keys={heatKeys} transform={transform} />
    </div>
  );
}

function Thresh({
  label,
  value,
  min,
  max,
  v,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  v: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular font-medium">{value}</span>
      </div>
      <Slider min={min} max={max} step={1} value={[v]} onValueChange={(x) => onChange(x[0] ?? v)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3 shadow-border">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-display mt-1 text-2xl tabular font-medium">{value}</div>
    </div>
  );
}
