import { useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useSlicedDataset, useStudio } from "@/lib/store";
import {
  MEMBER_FLAG_LABEL,
  alphaLabel,
  constructKBounds,
  suggestConstructs,
  type ConstructCandidate,
} from "@/lib/construct";
import { cn, fmt, fmtPct } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { SelectNative } from "./ui/select-native";

function draftFrom(constructs: ConstructCandidate[]) {
  return constructs.map((c) => ({
    id: c.id,
    name: c.name,
    keep: new Set(c.members.map((m) => m.key)),
  }));
}

export function ConstructButton() {
  const sliced = useSlicedDataset();
  const full = useStudio((s) => s.dataset);
  const transform = useStudio((s) => s.transform);
  const applyConstructs = useStudio((s) => s.applyConstructs);
  const ds = useMemo(() => ({ ...full, rows: sliced.rows }), [full, sliced.rows]);

  const [open, setOpen] = useState(false);
  const [kChoice, setKChoice] = useState("");
  const nItems = ds.indicators.filter((i) => i.selected).length;
  const bounds = constructKBounds(nItems);
  const kOpt = kChoice === "" ? null : Number(kChoice);
  const suggestion = useMemo(
    () => (open ? suggestConstructs(ds, transform, { k: kOpt }) : null),
    [open, ds, transform, kOpt],
  );
  const [draft, setDraft] = useState<{ id: string; name: string; keep: Set<string> }[]>([]);

  const view = draft.length ? draft : suggestion ? draftFrom(suggestion.constructs) : [];

  function toggle(id: string, key: string) {
    setDraft((prev) => {
      const base = prev.length ? prev : suggestion ? draftFrom(suggestion.constructs) : [];
      return base.map((c) => {
        if (c.id !== id) return c;
        const keep = new Set(c.keep);
        if (keep.has(key)) keep.delete(key);
        else keep.add(key);
        return { ...c, keep };
      });
    });
  }

  function rename(id: string, name: string) {
    setDraft((prev) => {
      const base = prev.length ? prev : suggestion ? draftFrom(suggestion.constructs) : [];
      return base.map((c) => (c.id === id ? { ...c, name } : c));
    });
  }

  function dropFlagged() {
    if (!suggestion) return;
    setDraft(
      suggestion.constructs.map((c) => {
        const preferred = c.members.filter(
          (m) => !m.flags.includes("redundant") && !m.flags.includes("hurts_alpha"),
        );
        const keys = preferred.map((m) => m.key);
        if (keys.length < 2) {
          const extra = c.members
            .filter((m) => !keys.includes(m.key) && !m.flags.includes("hurts_alpha"))
            .sort((a, b) => (b.loading ?? 0) - (a.loading ?? 0));
          for (const m of extra) {
            keys.push(m.key);
            if (keys.length >= 2) break;
          }
        }
        return {
          id: c.id,
          name: view.find((v) => v.id === c.id)?.name ?? c.name,
          keep: new Set(keys),
        };
      }),
    );
  }

  function apply() {
    if (!suggestion) return;
    const plan = view
      .map((c) => ({ name: c.name, keys: [...c.keep] }))
      .filter((c) => c.keys.length >= 2);
    if (!plan.length) {
      toast.error("每个构念至少保留 2 个指标");
      return;
    }
    applyConstructs(plan);
    toast.success(`已写入 ${plan.length} 个构念，请再核对名称与归属`);
    setOpen(false);
    setDraft([]);
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Wand2 />
        自动构念
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) {
            setDraft([]);
            setKChoice("");
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] w-[min(720px,calc(100vw-1.5rem))] flex-col overflow-hidden">
          <DialogTitle>自动构念建议</DialogTitle>
          <DialogDescription>
            {ds.kind === "survey"
              ? "问卷按探索性因子（平行分析 / Kaiser、方差最大化旋转）与 α / CITC 提出反映性量表。"
              : "面板按相关与变量名层次聚类，提出形成性准则层。簇内共线时只剔除最冗余的指标，保留代表性变量。"}
            可指定维度数后重新计算；确认后才写入体系，可改名、勾选成员。
          </DialogDescription>
          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {!suggestion ? (
              <p className="text-sm text-muted">计算中…</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="muted">{suggestion.mode === "factor" ? "问卷因子" : "面板分维"}</Badge>
                  <Badge variant="muted">纳入 {suggestion.nItems} 项</Badge>
                  {suggestion.kmo != null && (
                    <Badge variant={suggestion.kmo >= 0.6 ? "ok" : "warn"}>KMO {fmt(suggestion.kmo, 2)}</Badge>
                  )}
                  <label className="ml-auto flex items-center gap-1.5">
                    <span className="text-muted">维度数</span>
                    <SelectNative
                      className="h-9 w-[9.5rem] text-xs"
                      value={kChoice}
                      onChange={(e) => {
                        setKChoice(e.target.value);
                        setDraft([]);
                      }}
                      aria-label="构念维度数"
                    >
                      <option value="">
                        自动（推荐 {suggestion.recommendedK || "—"}）
                      </option>
                      {bounds.max >= bounds.min &&
                        bounds.min > 0 &&
                        Array.from({ length: bounds.max - bounds.min + 1 }, (_, i) => bounds.min + i).map((k) => (
                          <option key={k} value={String(k)}>
                            {k} 个
                          </option>
                        ))}
                    </SelectNative>
                  </label>
                </div>
                {suggestion.notes.map((n) => (
                  <p key={n} className="text-xs leading-relaxed text-muted">
                    {n}
                  </p>
                ))}
                {suggestion.constructs.map((c) => {
                  const row = view.find((v) => v.id === c.id);
                  const keep = row?.keep ?? new Set(c.members.map((m) => m.key));
                  return (
                    <article key={c.id} className="rounded-xl bg-bg p-3 shadow-border">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={row?.name ?? c.name}
                          onChange={(e) => rename(c.id, e.target.value)}
                          className="h-10 max-w-56 font-medium"
                          aria-label="构念名称"
                        />
                        {c.variance != null && (
                          <Badge variant="muted">解释 {fmtPct(c.variance)}</Badge>
                        )}
                        {suggestion.mode === "factor" ? (
                          <Badge variant={c.alpha != null && c.alpha >= 0.7 ? "ok" : "muted"}>
                            {alphaLabel(c.alpha)}
                          </Badge>
                        ) : (
                          c.meanAbsR != null && (
                            <Badge variant="muted">平均 |r| {fmt(c.meanAbsR, 2)}</Badge>
                          )
                        )}
                        {suggestion.mode === "factor" && c.meanAbsR != null && (
                          <Badge variant="muted">平均 |r| {fmt(c.meanAbsR, 2)}</Badge>
                        )}
                      </div>
                      <ul className="mt-2 space-y-1">
                        {c.members.map((m) => (
                          <li key={m.key} className="flex items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              className="size-4 accent-accent"
                              checked={keep.has(m.key)}
                              onChange={() => toggle(c.id, m.key)}
                              aria-label={`纳入 ${m.name}`}
                            />
                            <span className={cn("min-w-0 flex-1", !keep.has(m.key) && "text-subtle")}>
                              {m.name}
                            </span>
                            {m.loading != null && (
                              <span className="tabular text-muted">
                                {suggestion.mode === "factor" ? "λ" : "|r|"} {fmt(m.loading, 2)}
                              </span>
                            )}
                            {m.citc != null && suggestion.mode === "factor" && (
                              <span className="hidden tabular text-muted sm:inline">CITC {fmt(m.citc, 2)}</span>
                            )}
                            {m.flags.map((f) => (
                              <Badge key={f} variant="warn">
                                {MEMBER_FLAG_LABEL[f]}
                              </Badge>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
                {suggestion.leftover.length > 0 && (
                  <section>
                    <h3 className="text-sm font-medium">未归入</h3>
                    <ul className="mt-2 space-y-1 text-xs text-muted">
                      {suggestion.leftover.map((x) => (
                        <li key={x.key}>
                          {x.name}
                          <span className="text-subtle"> · {x.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {suggestion?.constructs.some((c) => c.members.some((m) => m.flags.length)) && (
              <Button variant="ghost" onClick={dropFlagged} title="共线组保留代表变量，只去掉最冗余项；降低信度的题仍剔除">
                按建议剔除
              </Button>
            )}
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={apply} disabled={!suggestion?.constructs.length}>
              写入体系
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
