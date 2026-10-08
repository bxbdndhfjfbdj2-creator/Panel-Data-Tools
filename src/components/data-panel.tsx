import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { Database, Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { SAMPLE_DATASETS } from "@/lib/datasets";
import { templateCsv, toCsv } from "@/lib/csv";
import { datasetFromFile } from "@/lib/io";
import { downloadBlob } from "@/lib/persist";
import { entityCount, groupCount, numericYears } from "@/lib/slice";
import { useSlicedDataset, useStudio } from "@/lib/store";
import { scaleHints } from "@/lib/diagnose";
import { STEPS } from "@/lib/types";
import { cn, fmt } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { SelectNative } from "./ui/select-native";
import { Input } from "./ui/input";
import { CatalogPanel } from "./catalog-panel";

export function DataPanel() {
  const ds = useStudio((s) => s.dataset);
  const sliced = useSlicedDataset();
  const yearFrom = useStudio((s) => s.yearFrom);
  const yearTo = useStudio((s) => s.yearTo);
  const setYearRange = useStudio((s) => s.setYearRange);
  const loadSample = useStudio((s) => s.loadSample);
  const importCsv = useStudio((s) => s.importCsv);
  const importDataset = useStudio((s) => s.importDataset);
  const setEntityKey = useStudio((s) => s.setEntityKey);
  const setTimeKey = useStudio((s) => s.setTimeKey);
  const setGroupKey = useStudio((s) => s.setGroupKey);
  const setWeightKey = useStudio((s) => s.setWeightKey);
  const setKind = useStudio((s) => s.setKind);
  const setStep = useStudio((s) => s.setStep);
  const renameIndicator = useStudio((s) => s.renameIndicator);
  const setDirection = useStudio((s) => s.setDirection);
  const setIndicatorUnit = useStudio((s) => s.setIndicatorUnit);

  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const headers = useMemo(() => {
    const first = ds.rows[0];
    return first ? Object.keys(first) : ds.indicators.map((i) => i.key);
  }, [ds.rows, ds.indicators]);

  const years = numericYears(ds);
  const preview = sliced.rows.slice(0, 8);

  async function ingestFile(file: File) {
    setBusy(true);
    const toastId = file.size > 8 * 1024 * 1024 ? toast.loading("正在解析大文件…") : undefined;
    try {
      const ds = await datasetFromFile(file);
      importDataset(ds);
      toast.success("已导入，请核对实体列、时间列与抽样权重");
      setOpen(false);
      setPaste("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      if (toastId) toast.dismiss(toastId);
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function ingest(name: string, text: string) {
    try {
      importCsv(name, text);
      toast.success("已导入，请核对实体列、时间列与抽样权重");
      setOpen(false);
      setPaste("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    }
  }

  function downloadCurrent() {
    const cols = headers.length ? headers : Object.keys(ds.rows[0] ?? {});
    downloadBlob(`${ds.name}.csv`, toCsv(cols, ds.rows), "text/csv");
    toast.success("已下载当前数据");
  }

  return (
    <div className="stagger-in space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest text-muted uppercase">数据集</p>
          <h2 className="font-display mt-1 text-2xl font-medium text-fg sm:text-3xl">
            {ds.name}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">{ds.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={downloadCurrent}>
            <Download />
            下载 CSV
          </Button>
          <Button variant="secondary" onClick={() => setOpen(true)} disabled={busy}>
            <Upload />
            导入数据
          </Button>
          <Button onClick={() => setStep("screen")}>开始筛选</Button>
        </div>
      </header>

      <ol className="grid gap-2 sm:grid-cols-5">
        {STEPS.map((s) => (
          <li key={s.id} className="rounded-xl bg-surface px-3 py-3 shadow-border">
            <div className="font-mono text-2xs text-subtle">{s.n}</div>
            <div className="mt-1 text-sm font-medium">{s.label}</div>
            <p className="mt-0.5 text-2xs text-muted">{s.hint}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2">
        {SAMPLE_DATASETS.map((s) => {
          const active = ds.id === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => loadSample(s.id)}
              className={cn(
                "rounded-xl p-4 text-left transition-[box-shadow,background-color] duration-[var(--motion-quick)]",
                active ? "bg-accent text-accent-fg shadow-border" : "bg-surface shadow-border hover:shadow-[var(--shadow-border-hover)]",
              )}
            >
              <div className="flex items-center gap-2">
                {s.kind === "panel" ? (
                  <Database className="size-4" />
                ) : (
                  <FileSpreadsheet className="size-4" />
                )}
                <span className="text-sm font-medium">{s.name}</span>
                <Badge variant={active ? "outline" : "muted"} className={active ? "border-accent-fg/30 text-accent-fg" : ""}>
                  {s.kind === "panel" ? "面板" : "问卷"}
                </Badge>
              </div>
              <p className={cn("mt-2 text-sm leading-relaxed", active ? "text-accent-fg/80" : "text-muted")}>
                {s.description}
              </p>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="观测" value={String(sliced.rows.length)} />
        <Stat label="指标" value={String(ds.indicators.length)} />
        <Stat
          label={ds.kind === "panel" ? "个体" : "样本"}
          value={String(entityCount(sliced))}
        />
        <Stat
          label={ds.kind === "panel" ? "时期" : "分组"}
          value={
            ds.kind === "panel"
              ? String(numericYears(sliced).length)
              : String(groupCount(sliced))
          }
        />
      </div>

      <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
        <h3 className="text-sm font-medium">字段映射</h3>
        <p className="mt-1 text-xs text-muted">筛选与聚合依赖实体列；面板还需时间列。分组列用于部门或区域对照。抽样权重用于问卷加权均值与熵权。</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="数据类型">
            <SelectNative value={ds.kind} onChange={(e) => setKind(e.target.value as "panel" | "survey")}>
              <option value="panel">面板（个体 × 时间）</option>
              <option value="survey">问卷（受访者 × 题目）</option>
            </SelectNative>
          </Field>
          <Field label="实体 / 编号">
            <SelectNative value={ds.entityKey} onChange={(e) => setEntityKey(e.target.value)}>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </SelectNative>
          </Field>
          <Field label="时间列">
            <SelectNative
              value={ds.timeKey ?? ""}
              onChange={(e) => setTimeKey(e.target.value || undefined)}
            >
              <option value="">无</option>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </SelectNative>
          </Field>
          <Field label="分组列">
            <SelectNative
              value={ds.groupKey ?? ""}
              onChange={(e) => setGroupKey(e.target.value || undefined)}
            >
              <option value="">无</option>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </SelectNative>
          </Field>
          <Field label="抽样权重">
            <SelectNative
              value={ds.weightKey ?? ""}
              onChange={(e) => setWeightKey(e.target.value || undefined)}
            >
              <option value="">无</option>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </SelectNative>
          </Field>
        </div>
        {ds.kind === "panel" && years.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field label="窗口起始">
              <SelectNative
                value={yearFrom == null ? "all" : String(yearFrom)}
                onChange={(e) =>
                  setYearRange(
                    e.target.value === "all" ? null : Number(e.target.value),
                    yearTo,
                  )
                }
              >
                <option value="all">不限</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </SelectNative>
            </Field>
            <Field label="窗口截止">
              <SelectNative
                value={yearTo == null ? "all" : String(yearTo)}
                onChange={(e) =>
                  setYearRange(
                    yearFrom,
                    e.target.value === "all" ? null : Number(e.target.value),
                  )
                }
              >
                <option value="all">不限</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </SelectNative>
            </Field>
            <div className="flex items-end">
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setYearRange(null, null)}
                disabled={yearFrom == null && yearTo == null}
              >
                恢复全部年份
              </Button>
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-subtle">{ds.sourceNote}</p>
      </section>

      <CatalogPanel />

      <ScaleHintBar />

      <section className="overflow-hidden rounded-xl bg-surface shadow-border">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">指标字典</h3>
          <p className="mt-1 text-xs text-muted">导入后可在此改名、标注单位与方向。负向指标如污染、能耗。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-bg-elevated text-muted">
                <th className="px-3 py-2 font-medium">字段</th>
                <th className="px-3 py-2 font-medium">显示名</th>
                <th className="px-3 py-2 font-medium">单位</th>
                <th className="px-3 py-2 font-medium">方向</th>
              </tr>
            </thead>
            <tbody>
              {ds.indicators.map((ind) => (
                <tr key={ind.key} className="border-b border-border/70 last:border-0">
                  <td className="px-3 py-2 font-mono text-2xs text-subtle">{ind.key}</td>
                  <td className="px-3 py-2">
                    <Input
                      value={ind.name}
                      onChange={(e) => renameIndicator(ind.key, e.target.value)}
                      className="h-9"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={ind.unit ?? ""}
                      onChange={(e) => setIndicatorUnit(ind.key, e.target.value)}
                      className="h-9 w-28"
                      placeholder="单位"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setDirection(ind.key, ind.direction === 1 ? -1 : 1)}
                      className={cn(
                        "min-h-9 rounded-full px-3 text-2xs font-medium",
                        ind.direction === 1 ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger",
                      )}
                    >
                      {ind.direction === 1 ? "正向" : "负向"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl bg-surface shadow-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-medium">预览</h3>
          <span className="text-xs text-muted">前 {preview.length} 行</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-bg-elevated">
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2 font-medium whitespace-nowrap text-muted">
                    {headerLabel(ds, h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-border/70 last:border-0">
                  {headers.map((h) => (
                    <td key={h} className="px-3 py-2 tabular whitespace-nowrap text-fg">
                      {formatCell(row[h])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>导入数据</DialogTitle>
          <DialogDescription>
            支持 CSV / TSV、Excel（.xls .xlsx）与 Stata 117–119（.dta）。面板建议含实体列与年份列；问卷建议含编号列、数值题目与抽样权重。数据只留在本机。
          </DialogDescription>
          <div className="mt-4 space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,.dta,.xls,.xlsx,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void ingestFile(f);
              }}
            />
            <Button variant="secondary" className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "解析中…" : "选择文件"}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  downloadBlob("面板模板.csv", templateCsv("panel"), "text/csv");
                  toast.success("已下载面板模板");
                }}
              >
                面板模板
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  downloadBlob("问卷模板.csv", templateCsv("survey"), "text/csv");
                  toast.success("已下载问卷模板");
                }}
              >
                问卷模板
              </Button>
            </div>
            <Label>或粘贴表格</Label>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              className="h-36 w-full rounded-md bg-bg px-3 py-2 font-mono text-xs text-fg shadow-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
              placeholder="省份,年份,人均GDP&#10;北京,2023,16.4"
            />
            <Button
              className="w-full"
              disabled={!paste.trim()}
              onClick={() => ingest("粘贴数据", paste)}
            >
              从粘贴导入
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScaleHintBar() {
  const ds = useSlicedDataset();
  const transform = useStudio((s) => s.transform);
  const setDirection = useStudio((s) => s.setDirection);
  const setTransform = useStudio((s) => s.setTransform);
  const hints = useMemo(() => scaleHints(ds, transform), [ds, transform]);
  const flips = hints.filter((h) => h.suggestDir !== h.currentDir);
  const logs = hints.filter((h) => h.suggestLog);
  if (!flips.length && !logs.length) return null;
  return (
    <section className="rounded-xl bg-surface p-4 shadow-border">
      <h3 className="text-sm font-medium">方向与量纲建议</h3>
      <p className="mt-1 text-xs text-muted">根据偏度、是否李克特、以及与其余纳入指标的相关提出，需确认后才改。李克特题不要取对数。</p>
      <ul className="mt-3 space-y-1.5 text-xs">
        {flips.slice(0, 8).map((h) => (
          <li key={h.key} className="flex items-center justify-between gap-2">
            <span>{h.name} · {h.note}</span>
            <Button size="sm" variant="secondary" onClick={() => setDirection(h.key, h.suggestDir)}>
              取反
            </Button>
          </li>
        ))}
        {logs.length > 0 && (
          <li className="flex items-center justify-between gap-2">
            <span>{logs.length} 个右偏指标建议 ln(1+x)</span>
            <Button size="sm" variant="secondary" onClick={() => setTransform({ logMode: "log1p" })}>
              启用对数
            </Button>
          </li>
        )}
      </ul>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
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

function headerLabel(ds: { indicators: { key: string; name: string }[] }, h: string) {
  return ds.indicators.find((i) => i.key === h)?.name ?? h;
}

function formatCell(v: string | number | null | undefined) {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return fmt(v, 2);
  }
  return String(v);
}
