import { useMemo } from "react";
import { indicatorCorr } from "@/lib/engine";
import type { Dataset } from "@/lib/types";
import { cn, fmt } from "@/lib/utils";

export function CorrHeat({
  dataset,
  keys,
}: {
  dataset: Dataset;
  keys?: string[];
}) {
  const { keys: used, names, R } = useMemo(
    () => indicatorCorr(dataset, keys ?? dataset.indicators.map((i) => i.key)),
    [dataset, keys],
  );

  if (used.length < 2) return null;

  return (
    <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
      <h3 className="text-sm font-medium">相关矩阵</h3>
      <p className="mt-1 text-xs text-muted">
        Pearson 两两相关。饱和度越高、|r| 越大；暖色为负相关。
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-px text-2xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface px-1 py-1" />
              {names.map((n, j) => (
                <th
                  key={used[j]}
                  className="max-w-16 truncate px-1 py-1 font-medium text-muted"
                  title={n}
                >
                  {n.length > 6 ? n.slice(0, 6) + "…" : n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((n, i) => (
              <tr key={used[i]}>
                <th
                  className="sticky left-0 max-w-24 truncate bg-surface px-1 py-1 text-left font-medium text-muted"
                  title={n}
                >
                  {n}
                </th>
                {used.map((_, j) => {
                  const r = R[i]![j]!;
                  const t = Math.max(-1, Math.min(1, Number.isFinite(r) ? r : 0));
                  const mag = Math.abs(t);
                  const hue = t >= 0 ? "var(--color-accent)" : "var(--color-danger)";
                  const bg = `color-mix(in oklab, ${hue} ${Math.round(mag * 72)}%, var(--color-bg-subtle))`;
                  const fg = mag > 0.55 ? "var(--color-accent-fg)" : "var(--color-fg)";
                  return (
                    <td key={used[j]} className="p-0">
                      <div
                        className={cn("rounded-xs px-1 py-1.5 text-center tabular")}
                        style={{ background: bg, color: fg }}
                        title={`${n} × ${names[j]} = ${fmt(r, 2)}`}
                      >
                        {i === j ? "1" : fmt(r, 2)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
