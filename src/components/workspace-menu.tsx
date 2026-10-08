import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FolderOpen } from "lucide-react";
import { parseWorkspace, readWorkspace, writeWorkspace, downloadBlob, type WorkspaceSnap } from "@/lib/persist";
import { useStudio } from "@/lib/store";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

export function WorkspaceMenu() {
  const hydrate = useStudio((s) => s.hydrate);
  const snapshot = useStudio((s) => s.snapshot);
  const reset = useStudio((s) => s.reset);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (!restored.current) {
      restored.current = true;
      const snap = readWorkspace();
      if (snap) {
        hydrate(snap);
        setSavedAt(snap.savedAt);
      } else {
        setSavedAt(null);
      }
    }
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsub = useStudio.subscribe(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        const snap: WorkspaceSnap = { ...useStudio.getState().snapshot(), savedAt: Date.now() };
        writeWorkspace(snap);
        setSavedAt(snap.savedAt);
      }, 500);
    });
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, [hydrate]);

  function restoreLocal() {
    const snap = readWorkspace();
    if (!snap) {
      toast.error("没有可恢复的方案");
      return;
    }
    hydrate(snap);
    toast.success("已恢复上次方案");
    setOpen(false);
  }

  function exportJson() {
    const snap: WorkspaceSnap = { ...snapshot(), savedAt: Date.now() };
    downloadBlob(`${snap.dataset.goalName}-方案.json`, JSON.stringify(snap, null, 2), "application/json");
    toast.success("已导出方案 JSON");
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <FolderOpen />
        方案
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>工作方案</DialogTitle>
          <DialogDescription>
            数据与设定只留在本机。刷新后自动恢复上次方案，也可导出 JSON 备份。
          </DialogDescription>
          <div className="mt-4 grid gap-2">
            <Button
              variant="secondary"
              disabled={!savedAt}
              onClick={restoreLocal}
            >
              恢复上次{savedAt ? `（${new Date(savedAt).toLocaleString("zh-CN")}）` : ""}
            </Button>
            <Button variant="secondary" onClick={exportJson}>
              导出方案 JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const snap = parseWorkspace(JSON.parse(await f.text()));
                  if (!snap) throw new Error("文件结构无法识别");
                  hydrate(snap);
                  toast.success("已导入方案");
                  setOpen(false);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "导入失败");
                }
              }}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              导入方案 JSON
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                reset();
                setOpen(false);
                toast.success("已回到省级面板示例");
              }}
            >
              重置为示例
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
