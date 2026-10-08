import type { ComponentType } from "react";
import { Toaster } from "sonner";
import { STEPS, type StepId } from "@/lib/types";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "./ui/tooltip";
import { DataPanel } from "./data-panel";
import { ScreenPanel } from "./screen-panel";
import { SystemPanel } from "./system-panel";
import { AggregatePanel } from "./aggregate-panel";
import { ResultsPanel } from "./results-panel";
import { WorkspaceMenu } from "./workspace-menu";
import { HelpButton } from "./help-dialog";
import { Badge } from "./ui/badge";

const PANELS: Record<StepId, ComponentType> = {
  data: DataPanel,
  screen: ScreenPanel,
  system: SystemPanel,
  aggregate: AggregatePanel,
  results: ResultsPanel,
};

export function Studio() {
  const step = useStudio((s) => s.step);
  const setStep = useStudio((s) => s.setStep);
  const ds = useStudio((s) => s.dataset);
  const yearFrom = useStudio((s) => s.yearFrom);
  const yearTo = useStudio((s) => s.yearTo);
  const Panel = PANELS[step];
  const windowed = ds.kind === "panel" && (yearFrom != null || yearTo != null);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-dvh flex-col">
        <div className="h-1 bg-accent" />
        <header className="border-b border-border bg-surface/80 backdrop-blur-sm">
          <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-xl font-medium tracking-tight">衡策</span>
                <span className="hidden text-2xs tracking-widest text-muted sm:inline">HENGCE</span>
              </div>
              <p className="flex min-w-0 items-center gap-2 truncate text-xs text-muted">
                <span className="truncate">
                  {ds.kind === "panel" ? "面板" : "问卷"} · {ds.name}
                </span>
                {windowed && (
                  <Badge variant="muted">
                    {yearFrom ?? "始"}–{yearTo ?? "末"}
                  </Badge>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <HelpButton />
              <WorkspaceMenu />
            </div>
          </div>
          <nav
            className="mx-auto flex max-w-[1280px] gap-1 overflow-x-auto px-3 pb-3 sm:px-6"
            aria-label="工作步骤"
          >
            {STEPS.map((s, i) => {
              const active = s.id === step;
              const done = STEPS.findIndex((x) => x.id === step) > i;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStep(s.id)}
                  className={cn(
                    "flex min-h-11 min-w-[7.5rem] flex-1 items-center gap-2 rounded-md px-3 py-2 text-left transition-colors duration-[var(--motion-quick)]",
                    active ? "bg-accent text-accent-fg" : "bg-bg hover:bg-accent-soft",
                  )}
                >
                  <span className={cn("font-mono text-2xs", active ? "text-accent-fg/70" : "text-subtle")}>
                    {s.n}
                  </span>
                  <span>
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className={cn("hidden text-2xs sm:block", active ? "text-accent-fg/70" : "text-subtle")}>
                      {done ? "已编辑" : s.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Panel />
        </main>

        <footer className="border-t border-border px-4 py-4 text-center text-2xs text-subtle sm:px-6">
          分析数据在浏览器内计算，不由应用上传；方案保存在本机浏览器。页面会加载托管平台资源和 Google Fonts。示意样本不可作为正式统计引用。
        </footer>
      </div>
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "font-sans",
          style: {
            background: "var(--color-surface)",
            color: "var(--color-fg)",
            border: "1px solid var(--color-border)",
          },
        }}
      />
    </TooltipProvider>
  );
}
