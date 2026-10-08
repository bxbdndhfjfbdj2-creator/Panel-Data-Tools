import { useMemo, useState } from "react";
import { toast } from "sonner";
import { getImportBuffer } from "@/lib/catalog";
import { useStudio } from "@/lib/store";
import { fmtPct } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";

export function CatalogPanel() {
  const ds = useStudio((s) => s.dataset);
  const addFromCatalog = useStudio((s) => s.addFromCatalog);
  const catalog = ds.catalog ?? [];
  const have = useMemo(() => new Set(ds.indicators.map((i) => i.key)), [ds.indicators]);
  const rest = catalog.filter((c) => !have.has(c.key));
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Set<string>>(() => new Set());
  const buf = getImportBuffer();
  const live = buf?.id === ds.id;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rest;
    return rest.filter(
      (c) =>
        c.key.toLowerCase().includes(s) ||
        c.name.toLowerCase().includes(s) ||
        c.battery.toLowerCase().includes(s),
    );
  }, [rest, q]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const c of filtered) {
      const arr = m.get(c.battery);
      if (arr) arr.push(c);
      else m.set(c.battery, [c]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  if (!catalog.length || !rest.length) return null;

  function toggle(key: string) {
    setPick((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function toggleGroup(keys: string[]) {
    setPick((prev) => {
      const n = new Set(prev);
      const all = keys.every((k) => n.has(k));
      for (const k of keys) {
        if (all) n.delete(k);
        else n.add(k);
      }
      return n;
    });
  }

  function apply() {
    const keys = [...pick];
    if (!keys.length) {
      toast.error("请先勾选题组或变量");
      return;
    }
    const r = addFromCatalog(keys);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    toast.success(`已加入 ${r.added.length} 列${r.skipped.length ? `，跳过 ${r.skipped.length}` : ""}`);
    setPick(new Set());
  }

  return (
    <section className="rounded-xl bg-surface p-4 shadow-border sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">宽表题组</h3>
          <p className="mt-1 text-xs text-muted">
            原表还有 {rest.length} 个数值列未纳入。按前缀或名称搜索后勾选加入（最多 80 个）。
            {!live && " 刷新后需重新导入才能加入未物化列。"}
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索 A36 / 信任 / gdp…"
            className="h-10 w-44"
          />
          <Button onClick={apply} disabled={!pick.size || !live}>
            加入 {pick.size || ""}
          </Button>
        </div>
      </div>
      <div className="mt-3 max-h-72 space-y-3 overflow-auto">
        {groups.slice(0, 24).map(([bat, items]) => (
          <div key={bat}>
            <button
              type="button"
              className="mb-1 text-xs font-medium text-muted"
              onClick={() => toggleGroup(items.map((i) => i.key))}
            >
              {bat}
              <Badge variant="muted" className="ml-2">
                {items.length}
              </Badge>
            </button>
            <ul className="flex flex-wrap gap-1.5">
              {items.slice(0, 40).map((c) => (
                <li key={c.key}>
                  <label className="flex min-h-8 cursor-pointer items-center gap-1 rounded-md bg-bg px-2 py-1 text-2xs">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={pick.has(c.key)}
                      onChange={() => toggle(c.key)}
                    />
                    <span className="max-w-40 truncate" title={c.name}>
                      {c.name}
                    </span>
                    <span className="tabular text-subtle">{fmtPct(c.fill, 0)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
