import { Plus, Trash2, Download } from "lucide-react";
import { toast } from "sonner";
import { useMemo } from "react";
import { useStudio } from "@/lib/store";
import { buildCodebook } from "@/lib/report";
import { constructFit } from "@/lib/diagnose";
import { downloadBlob } from "@/lib/persist";
import { cn, fmt } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Slider } from "./ui/slider";
import { Badge } from "./ui/badge";
import { SelectNative } from "./ui/select-native";
import { SystemTree } from "./system-tree";
import { AhpButton } from "./ahp-panel";
import { ConstructButton } from "./construct-dialog";

export function SystemPanel() {
  const ds = useStudio((s) => s.dataset);
  const setGoalName = useStudio((s) => s.setGoalName);
  const addDimension = useStudio((s) => s.addDimension);
  const renameDimension = useStudio((s) => s.renameDimension);
  const removeDimension = useStudio((s) => s.removeDimension);
  const setDimWeight = useStudio((s) => s.setDimWeight);
  const setDimMeasure = useStudio((s) => s.setDimMeasure);
  const transform = useStudio((s) => s.transform);
  const fit = useMemo(() => constructFit(ds, transform), [ds, transform]);
  const normalizeDimWeights = useStudio((s) => s.normalizeDimWeights);
  const assignIndicator = useStudio((s) => s.assignIndicator);
  const setDirection = useStudio((s) => s.setDirection);
  const toggleIndicator = useStudio((s) => s.toggleIndicator);
  const renameIndicator = useStudio((s) => s.renameIndicator);
  const setStep = useStudio((s) => s.setStep);

  const dimSum = ds.dimensions.reduce((a, d) => a + d.weight, 0);
  const unassigned = ds.indicators.filter((i) => i.selected && !i.dimensionId);
  const selected = ds.indicators.filter((i) => i.selected);

  return (
    <div className="stagger-in space-y-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-widest text-muted uppercase">结构</p>
          <Input
            value={ds.goalName}
            onChange={(e) => setGoalName(e.target.value)}
            className="font-display mt-1 h-12 border-0 bg-transparent px-0 text-2xl font-medium shadow-none focus-visible:ring-0 sm:text-3xl"
            aria-label="目标层名称"
          />
          <p className="max-w-2xl text-sm text-muted">
            目标层 → 准则层 → 指标层。可先让统计提出可聚合的构念候选，确认后再写入；也可用滑块或层次分析法设定维度权重。负向指标在聚合时会反向标准化。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={addDimension}>
            <Plus />
            增加维度
          </Button>
          <ConstructButton />
          <AhpButton />
          <Button variant="secondary" onClick={normalizeDimWeights}>
            维度权重归一
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              downloadBlob(`${ds.goalName}-码本.md`, buildCodebook(ds), "text/markdown");
              toast.success("已导出指标码本");
            }}
          >
            <Download />
            码本
          </Button>
          <Button onClick={() => setStep("aggregate")}>去赋权</Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={Math.abs(dimSum - 1) < 0.02 ? "ok" : "warn"}>
          维度权重合计 {fmt(dimSum, 2)}
        </Badge>
        <Badge variant="muted">纳入 {selected.length} 项</Badge>
        {unassigned.length > 0 && (
          <Badge variant="warn">未归维 {unassigned.length} 项</Badge>
        )}
        {fit.between.slice(0, 4).map((b) => (
          <Badge key={b.a + b.b} variant={Math.abs(b.r) > 0.7 ? "warn" : "muted"}>
            {ds.dimensions.find((d) => d.id === b.a)?.name}·{ds.dimensions.find((d) => d.id === b.b)?.name} r {fmt(b.r, 2)}
          </Badge>
        ))}
      </div>

      <SystemTree />

      <div className="grid gap-4 lg:grid-cols-2">
        {ds.dimensions.map((dim) => {
          const members = ds.indicators.filter((i) => i.dimensionId === dim.id);
          return (
            <article key={dim.id} className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
              <div className="flex items-start gap-2">
                <Input
                  value={dim.name}
                  onChange={(e) => renameDimension(dim.id, e.target.value)}
                  className="h-11 font-medium"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeDimension(dim.id)}
                  aria-label={`删除 ${dim.name}`}
                >
                  <Trash2 />
                </Button>
              </div>
              {dim.description && (
                <p className="mt-2 text-xs text-muted">{dim.description}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <SelectNative
                  value={dim.measure ?? (ds.kind === "survey" ? "reflective" : "formative")}
                  onChange={(e) => setDimMeasure(dim.id, e.target.value as "reflective" | "formative")}
                  className="h-9 w-28 text-xs"
                >
                  <option value="reflective">反映性</option>
                  <option value="formative">形成性</option>
                </SelectNative>
                {fit.dims.find((f) => f.id === dim.id)?.alpha != null && (
                  <Badge variant="muted">
                    α {fmt(fit.dims.find((f) => f.id === dim.id)!.alpha, 2)}
                  </Badge>
                )}
                {fit.dims.find((f) => f.id === dim.id)?.ave != null && (
                  <Badge variant="muted">
                    AVE {fmt(fit.dims.find((f) => f.id === dim.id)!.ave, 2)}
                  </Badge>
                )}
                {fit.dims.find((f) => f.id === dim.id)?.cr != null && (
                  <Badge variant="muted">
                    CR {fmt(fit.dims.find((f) => f.id === dim.id)!.cr, 2)}
                  </Badge>
                )}
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">维度权重</span>
                  <span className="tabular font-medium">{fmt(dim.weight, 2)}</span>
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[dim.weight * 100]}
                  onValueChange={(v) => setDimWeight(dim.id, (v[0] ?? 0) / 100)}
                />
              </div>
              <ul className="mt-3 space-y-1.5">
                {members.map((ind) => (
                  <li
                    key={ind.key}
                    className="flex items-center gap-2 rounded-md bg-bg px-2 py-1.5"
                  >
                    <input
                      type="checkbox"
                      checked={ind.selected}
                      onChange={(e) => toggleIndicator(ind.key, e.target.checked)}
                      className="size-4 accent-accent"
                      aria-label={`纳入 ${ind.name}`}
                    />
                    <input
                      value={ind.name}
                      onChange={(e) => renameIndicator(ind.key, e.target.value)}
                      className={cn(
                        "min-w-0 flex-1 bg-transparent text-sm outline-none",
                        !ind.selected && "text-subtle",
                      )}
                      aria-label="指标名称"
                    />
                    <button
                      type="button"
                      onClick={() => setDirection(ind.key, ind.direction === 1 ? -1 : 1)}
                      className={cn(
                        "min-h-8 shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium",
                        ind.direction === 1 ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger",
                      )}
                    >
                      {ind.direction === 1 ? "正向" : "负向"}
                    </button>
                    <button
                      type="button"
                      className="min-h-8 shrink-0 text-2xs text-muted hover:text-fg"
                      onClick={() => assignIndicator(ind.key, null)}
                    >
                      移出
                    </button>
                  </li>
                ))}
                {members.length === 0 && (
                  <li className="py-3 text-center text-xs text-subtle">此维度尚无指标</li>
                )}
              </ul>
              <div className="mt-3">
                <SelectNative
                  value=""
                  onChange={(e) => {
                    if (e.target.value) assignIndicator(e.target.value, dim.id);
                  }}
                >
                  <option value="">加入指标…</option>
                  {ds.indicators
                    .filter((i) => i.dimensionId !== dim.id)
                    .map((i) => (
                      <option key={i.key} value={i.key}>
                        {i.name}
                        {i.dimensionId ? "（移动）" : ""}
                      </option>
                    ))}
                </SelectNative>
              </div>
            </article>
          );
        })}
      </div>

      {fit.between.length > 0 && (
        <section className="rounded-xl bg-surface p-4 shadow-border">
          <h3 className="text-sm font-medium">构念诊断</h3>
          <p className="mt-1 text-xs text-muted">
            反映性量表看 α / AVE / CR；形成性维度 α 只作参考。维间相关过高说明维度区分不足。
          </p>
          <ul className="mt-3 space-y-1 text-xs">
            {fit.between.map((b) => {
              const an = ds.dimensions.find((d) => d.id === b.a)?.name ?? b.a;
              const bn = ds.dimensions.find((d) => d.id === b.b)?.name ?? b.b;
              return (
                <li key={b.a + b.b} className="flex justify-between">
                  <span>
                    {an} · {bn}
                  </span>
                  <span className={cn("tabular", Math.abs(b.r) > 0.7 ? "text-warn" : "")}>
                    r {fmt(b.r, 2)}
                  </span>
                </li>
              );
            })}
          </ul>
          {fit.notes.map((n) => (
            <p key={n} className="mt-2 text-xs text-muted">
              {n}
            </p>
          ))}
        </section>
      )}

      {unassigned.length > 0 && (
        <section className="rounded-xl bg-surface p-4 shadow-border">
          <h3 className="text-sm font-medium">待归维</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {unassigned.map((i) => (
              <Badge key={i.key} variant="outline">
                {i.name}
              </Badge>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
