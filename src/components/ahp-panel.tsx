import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  consistencyLabel,
  formatSaaty,
  identityMatrix,
  saatyFromStep,
  setPair,
  solveAhp,
  stepFromSaaty,
} from "@/lib/ahp";
import { useStudio } from "@/lib/store";
import { cn, fmt, fmtPct } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Slider } from "./ui/slider";

export function AhpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        层次分析
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(720px,calc(100vw-1.5rem))] max-h-[85vh] overflow-y-auto">
          <DialogTitle>层次分析法赋权</DialogTitle>
          <DialogDescription>
            对准则层两两比较，按 Saaty 1–9 标度生成维度权重。一致性比率 CR 小于 0.1 时可以接受。
          </DialogDescription>
          {open && <AhpForm onApplied={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AhpForm({ onApplied }: { onApplied: () => void }) {
  const ds = useStudio((s) => s.dataset);
  const setDimWeights = useStudio((s) => s.setDimWeights);
  const dims = ds.dimensions;
  const n = dims.length;

  const pairs = useMemo(() => {
    const out: { i: number; j: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) out.push({ i, j });
    }
    return out;
  }, [n]);

  const [matrix, setMatrix] = useState(() => identityMatrix(n));
  const result = useMemo(() => solveAhp(matrix), [matrix]);
  const tone = consistencyLabel(result.cr);

  if (n < 2) {
    return <p className="mt-4 text-sm text-muted">至少两个维度才能进行两两比较。</p>;
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tone.tone === "ok" ? "ok" : tone.tone === "warn" ? "warn" : "danger"}>
          {tone.text}
        </Badge>
        <span className="text-xs text-muted">
          λ<sub>max</sub> {fmt(result.lambda, 3)} · CI {fmt(result.ci, 3)} · CR {fmt(result.cr, 3)}
        </span>
      </div>

      <ul className="space-y-4">
        {pairs.map(({ i, j }) => {
          const left = dims[i]!;
          const right = dims[j]!;
          const v = matrix[i]![j]!;
          const step = stepFromSaaty(v);
          return (
            <li key={`${left.id}-${right.id}`} className="rounded-lg bg-bg p-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium">{left.name}</span>
                <span className="tabular text-muted">{formatSaaty(v)}</span>
                <span className="min-w-0 truncate text-right font-medium">{right.name}</span>
              </div>
              <Slider
                className="mt-1"
                min={-8}
                max={8}
                step={1}
                value={[step]}
                onValueChange={(x) => {
                  const s = x[0] ?? 0;
                  setMatrix((m) => setPair(m, i, j, saatyFromStep(s)));
                }}
              />
              <div className="mt-1 flex justify-between text-2xs text-subtle">
                <span>左侧更重要</span>
                <span>同等</span>
                <span>右侧更重要</span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="overflow-x-auto rounded-lg bg-bg">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="px-3 py-2 font-medium">准则</th>
              <th className="px-3 py-2 font-medium tabular">AHP 权重</th>
              <th className="px-3 py-2 font-medium tabular">当前权重</th>
            </tr>
          </thead>
          <tbody>
            {dims.map((d, i) => (
              <tr key={d.id} className="border-b border-border/70 last:border-0">
                <td className="px-3 py-2">{d.name}</td>
                <td className="px-3 py-2 tabular font-medium">{fmtPct(result.weights[i])}</td>
                <td className="px-3 py-2 tabular text-muted">{fmtPct(d.weight)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            const w: Record<string, number> = {};
            dims.forEach((d, i) => {
              w[d.id] = result.weights[i] ?? 0;
            });
            setDimWeights(w);
            toast.success(
              result.cr >= 0.1 ? "已应用权重（一致性仍偏弱）" : "已将 AHP 权重写入准则层",
            );
            onApplied();
          }}
        >
          应用为维度权重
        </Button>
        <Button variant="ghost" onClick={() => setMatrix(identityMatrix(n))}>
          重置判断
        </Button>
      </div>
      <p className={cn("text-2xs", tone.tone === "danger" ? "text-danger" : "text-subtle")}>
        判断矩阵仅保存在此次会话中。应用后写入准则层，可与熵权、CRITIC 等指标层方法组合。
      </p>
    </div>
  );
}
