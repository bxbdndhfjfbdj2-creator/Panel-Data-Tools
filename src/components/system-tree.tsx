import { useStudio } from "@/lib/store";
import { cn, fmtPct } from "@/lib/utils";

export function SystemTree() {
  const ds = useStudio((s) => s.dataset);
  const selected = ds.indicators.filter((i) => i.selected && i.dimensionId);
  const cols =
    ds.dimensions.length <= 2
      ? "grid-cols-1 sm:grid-cols-2"
      : ds.dimensions.length === 3
        ? "grid-cols-1 sm:grid-cols-3"
        : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";

  return (
    <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-medium">层级结构</h3>
        <p className="mt-1 text-xs text-muted">目标层 → 准则层 → 指标层。权重为当前维度设定，指标权重在聚合步计算。</p>
      </div>
      <div className="flex flex-col items-stretch">
        <div className="mx-auto max-w-full rounded-lg bg-accent px-5 py-2.5 text-center">
          <div className="text-2xs tracking-widest text-accent-fg/70">目标层</div>
          <div className="text-sm font-medium text-accent-fg">{ds.goalName}</div>
        </div>
        <div className="mx-auto h-4 w-px bg-border" />
        <div className={cn("grid gap-3", cols)}>
          {ds.dimensions.map((dim) => {
            const members = selected.filter((i) => i.dimensionId === dim.id);
            return (
              <div key={dim.id} className="flex min-w-0 flex-col">
                <div className="mx-auto h-4 w-px bg-border" />
                <div className="flex-1 rounded-lg bg-bg p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{dim.name}</span>
                    <span className="tabular text-2xs text-muted">{fmtPct(dim.weight, 0)}</span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {members.map((ind) => (
                      <li key={ind.key} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-muted">{ind.name}</span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-2xs",
                            ind.direction === 1 ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger",
                          )}
                        >
                          {ind.direction === 1 ? "正" : "负"}
                        </span>
                      </li>
                    ))}
                    {members.length === 0 && (
                      <li className="text-2xs text-subtle">未纳入指标</li>
                    )}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
