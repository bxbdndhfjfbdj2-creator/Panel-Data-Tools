import type {
  AggMethod,
  Dataset,
  MissingMode,
  ScreeningThresholds,
  Standardize,
  StepId,
  TransformSpec,
} from "./types";

export const WORKSPACE_KEY = "hengce.workspace.v1";

export interface WorkspaceSnap {
  v: 1;
  savedAt: number;
  step: StepId;
  dataset: Dataset;
  thresholds: ScreeningThresholds;
  method: AggMethod;
  standardize: Standardize;
  missingMode?: MissingMode;
  transform?: TransformSpec;
  yearFrom?: number | null;
  yearTo?: number | null;
  resultYear?: number | null;
  resultMode?: "latest" | "mean";
  heatSelectedOnly?: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function parseWorkspace(raw: unknown): WorkspaceSnap | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  if (!isRecord(raw.dataset) || !Array.isArray(raw.dataset.rows)) return null;
  if (!Array.isArray(raw.dataset.indicators) || !Array.isArray(raw.dataset.dimensions)) return null;
  return raw as unknown as WorkspaceSnap;
}

export function readWorkspace(): WorkspaceSnap | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const text = localStorage.getItem(WORKSPACE_KEY);
    if (!text) return null;
    return parseWorkspace(JSON.parse(text));
  } catch {
    return null;
  }
}

export function writeWorkspace(snap: WorkspaceSnap) {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(snap));
  } catch {
    /* quota */
  }
}

export function downloadBlob(filename: string, text: string, mime: string) {
  const blob = new Blob(["\uFEFF" + text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
