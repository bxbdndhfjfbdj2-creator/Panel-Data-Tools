import { create } from "zustand";
import { useMemo } from "react";
import { SAMPLE_DATASETS } from "./datasets";
import { datasetFromCsv } from "./csv";
import { DEFAULT_THRESHOLDS, DEFAULT_TRANSFORM } from "./types";
import type {
  AggMethod,
  Dataset,
  Dimension,
  IndicatorMeta,
  MeasureKind,
  MissingMode,
  ScreeningThresholds,
  Standardize,
  StepId,
  TransformSpec,
} from "./types";
import { uid } from "./utils";
import type { WorkspaceSnap } from "./persist";
import { sliceByYear } from "./slice";
import { directionFromName, materializeKeys } from "./catalog";

function cloneDs(ds: Dataset): Dataset {
  return structuredClone(ds);
}

interface StudioState {
  step: StepId;
  dataset: Dataset;
  thresholds: ScreeningThresholds;
  method: AggMethod;
  standardize: Standardize;
  missingMode: MissingMode;
  transform: TransformSpec;
  yearFrom: number | null;
  yearTo: number | null;
  resultYear: number | null;
  resultMode: "latest" | "mean";
  heatSelectedOnly: boolean;
  focusEntity: string | null;
  setStep: (s: StepId) => void;
  loadSample: (id: string) => void;
  importCsv: (name: string, text: string) => void;
  importDataset: (ds: Dataset) => void;
  setEntityKey: (k: string) => void;
  setTimeKey: (k: string | undefined) => void;
  setGroupKey: (k: string | undefined) => void;
  setWeightKey: (k: string | undefined) => void;
  setKind: (k: Dataset["kind"]) => void;
  toggleIndicator: (key: string, selected: boolean) => void;
  setDirection: (key: string, dir: 1 | -1) => void;
  renameIndicator: (key: string, name: string) => void;
  setIndicatorUnit: (key: string, unit: string) => void;
  applyScreening: (failKeys: string[]) => void;
  selectAllPass: (passKeys: string[]) => void;
  setThreshold: (patch: Partial<ScreeningThresholds>) => void;
  setGoalName: (name: string) => void;
  addDimension: () => void;
  renameDimension: (id: string, name: string) => void;
  removeDimension: (id: string) => void;
  setDimWeight: (id: string, w: number) => void;
  setDimWeights: (w: Record<string, number>) => void;
  normalizeDimWeights: () => void;
  assignIndicator: (key: string, dimId: string | null) => void;
  applyConstructs: (plan: { name: string; description?: string; keys: string[] }[], dropKeys?: string[]) => void;
  setDimMeasure: (id: string, measure: MeasureKind) => void;
  addFromCatalog: (keys: string[]) => { added: string[]; skipped: string[]; error?: string };
  setIndicatorWeight: (key: string, w: number) => void;
  normalizeLeafWeights: (dimId: string) => void;
  setMethod: (m: AggMethod) => void;
  setStandardize: (s: Standardize) => void;
  setMissingMode: (m: MissingMode) => void;
  setTransform: (p: Partial<TransformSpec>) => void;
  setYearRange: (from: number | null, to: number | null) => void;
  setResultYear: (y: number | null) => void;
  setResultMode: (m: "latest" | "mean") => void;
  setHeatSelectedOnly: (v: boolean) => void;
  setFocusEntity: (e: string | null) => void;
  hydrate: (snap: WorkspaceSnap) => void;
  snapshot: () => Omit<WorkspaceSnap, "savedAt">;
  reset: () => void;
}

const first = cloneDs(SAMPLE_DATASETS[0]!);

function fromSnap(snap: WorkspaceSnap | null) {
  if (!snap) {
    return {
      step: "data" as StepId,
      dataset: first,
      thresholds: { ...DEFAULT_THRESHOLDS },
      method: "entropy" as AggMethod,
      standardize: "minmax" as Standardize,
      missingMode: "listwise" as MissingMode,
      transform: { ...DEFAULT_TRANSFORM },
      yearFrom: null as number | null,
      yearTo: null as number | null,
      resultYear: null as number | null,
      resultMode: "latest" as const,
      heatSelectedOnly: false,
      focusEntity: null as string | null,
    };
  }
  return {
    step: snap.step,
    dataset: snap.dataset,
    thresholds: snap.thresholds,
    method: snap.method,
    standardize: snap.standardize,
    missingMode: snap.missingMode ?? ("listwise" as MissingMode),
    transform: {
      winsor: snap.transform?.winsor ?? 0,
      logMode: snap.transform?.logMode ?? "off",
    },
    yearFrom: snap.yearFrom ?? null,
    yearTo: snap.yearTo ?? null,
    resultYear: snap.resultYear ?? null,
    resultMode: snap.resultMode === "mean" ? ("mean" as const) : ("latest" as const),
    heatSelectedOnly: snap.heatSelectedOnly ?? false,
    focusEntity: null as string | null,
  };
}

const seed = fromSnap(null);

function patchInd(
  dataset: Dataset,
  key: string,
  patch: Partial<IndicatorMeta>,
): Dataset {
  return {
    ...dataset,
    indicators: dataset.indicators.map((i) => (i.key === key ? { ...i, ...patch } : i)),
  };
}

const defaults = {
  ...seed,
};

export const useStudio = create<StudioState>()((set, get) => ({
  ...defaults,

  setStep: (step) => set({ step }),

  loadSample: (id) => {
    const found = SAMPLE_DATASETS.find((d) => d.id === id);
    if (!found) return;
    set({
      dataset: cloneDs(found),
      focusEntity: null,
      yearFrom: null,
      yearTo: null,
      resultYear: null,
      transform: { ...DEFAULT_TRANSFORM },
      step: "data",
    });
  },

  importCsv: (name, text) => {
    const ds = datasetFromCsv(name, text);
    set({
      dataset: ds,
      focusEntity: null,
      yearFrom: null,
      yearTo: null,
      resultYear: null,
      transform: { ...DEFAULT_TRANSFORM },
      step: "data",
    });
  },

  importDataset: (ds) => {
    set({
      dataset: ds,
      focusEntity: null,
      yearFrom: null,
      yearTo: null,
      resultYear: null,
      transform: { ...DEFAULT_TRANSFORM },
      step: "data",
    });
  },

  setEntityKey: (entityKey) => set({ dataset: { ...get().dataset, entityKey } }),
  setTimeKey: (timeKey) => set({ dataset: { ...get().dataset, timeKey } }),
  setGroupKey: (groupKey) => set({ dataset: { ...get().dataset, groupKey } }),
  setWeightKey: (weightKey) => set({ dataset: { ...get().dataset, weightKey } }),
  setKind: (kind) => set({ dataset: { ...get().dataset, kind } }),

  toggleIndicator: (key, selected) => set({ dataset: patchInd(get().dataset, key, { selected }) }),
  setDirection: (key, direction) => set({ dataset: patchInd(get().dataset, key, { direction }) }),
  renameIndicator: (key, name) => set({ dataset: patchInd(get().dataset, key, { name }) }),
  setIndicatorUnit: (key, unit) => set({ dataset: patchInd(get().dataset, key, { unit }) }),

  applyScreening: (failKeys) => {
    const fail = new Set(failKeys);
    const dataset = get().dataset;
    set({
      dataset: {
        ...dataset,
        indicators: dataset.indicators.map((i) =>
          fail.has(i.key) ? { ...i, selected: false } : i,
        ),
      },
    });
  },

  selectAllPass: (passKeys) => {
    const pass = new Set(passKeys);
    const dataset = get().dataset;
    set({
      dataset: {
        ...dataset,
        indicators: dataset.indicators.map((i) => ({
          ...i,
          selected: pass.has(i.key),
        })),
      },
    });
  },

  setThreshold: (patch) => set({ thresholds: { ...get().thresholds, ...patch } }),

  setGoalName: (goalName) => set({ dataset: { ...get().dataset, goalName } }),

  addDimension: () => {
    const dataset = get().dataset;
    const d: Dimension = {
      id: uid("dim"),
      name: `维度 ${dataset.dimensions.length + 1}`,
      weight: 0,
      measure: dataset.kind === "survey" ? "reflective" : "formative",
    };
    const dimensions = [...dataset.dimensions, d];
    const w = 1 / dimensions.length;
    set({
      dataset: {
        ...dataset,
        dimensions: dimensions.map((x) => ({ ...x, weight: w })),
      },
    });
  },

  renameDimension: (id, name) => {
    const dataset = get().dataset;
    set({
      dataset: {
        ...dataset,
        dimensions: dataset.dimensions.map((d) => (d.id === id ? { ...d, name } : d)),
      },
    });
  },

  removeDimension: (id) => {
    const dataset = get().dataset;
    if (dataset.dimensions.length <= 1) return;
    const dimensions = dataset.dimensions.filter((d) => d.id !== id);
    const w = 1 / dimensions.length;
    set({
      dataset: {
        ...dataset,
        dimensions: dimensions.map((d) => ({ ...d, weight: w })),
        indicators: dataset.indicators.map((i) =>
          i.dimensionId === id ? { ...i, dimensionId: null, selected: false } : i,
        ),
      },
    });
  },

  setDimWeight: (id, weight) => {
    const dataset = get().dataset;
    set({
      dataset: {
        ...dataset,
        dimensions: dataset.dimensions.map((d) => (d.id === id ? { ...d, weight } : d)),
      },
    });
  },

  setDimWeights: (w) => {
    const dataset = get().dataset;
    set({
      dataset: {
        ...dataset,
        dimensions: dataset.dimensions.map((d) =>
          w[d.id] != null ? { ...d, weight: w[d.id]! } : d,
        ),
      },
    });
  },

  normalizeDimWeights: () => {
    const dataset = get().dataset;
    const s = dataset.dimensions.reduce((a, d) => a + d.weight, 0);
    const dimensions = dataset.dimensions.map((d) => ({
      ...d,
      weight: s ? d.weight / s : 1 / dataset.dimensions.length,
    }));
    set({ dataset: { ...dataset, dimensions } });
  },

  assignIndicator: (key, dimId) => {
    const dataset = get().dataset;
    set({
      dataset: {
        ...dataset,
        indicators: dataset.indicators.map((i) =>
          i.key === key
            ? { ...i, dimensionId: dimId, selected: dimId != null ? true : i.selected }
            : i,
        ),
      },
    });
  },

  applyConstructs: (plan, dropKeys = []) => {
    if (!plan.length) return;
    const dataset = get().dataset;
    const drop = new Set(dropKeys);
    const dimensions: Dimension[] = plan.map((p) => ({
      id: uid("dim"),
      name: p.name.trim() || "未命名构念",
      weight: 1 / plan.length,
      description: p.description,
      measure: dataset.kind === "survey" ? "reflective" : "formative",
    }));
    const keyToDim = new Map<string, string>();
    plan.forEach((p, i) => {
      const id = dimensions[i]!.id;
      for (const k of p.keys) keyToDim.set(k, id);
    });
    const indicators = dataset.indicators.map((ind) => {
      if (drop.has(ind.key)) {
        return { ...ind, selected: false, dimensionId: null };
      }
      const dimId = keyToDim.get(ind.key);
      if (dimId) {
        const n = plan.find((p) => p.keys.includes(ind.key))?.keys.length ?? 1;
        return { ...ind, selected: true, dimensionId: dimId, weight: n ? 1 / n : 1 };
      }
      if (ind.selected) return { ...ind, dimensionId: null };
      return ind;
    });
    set({ dataset: { ...dataset, dimensions, indicators } });
  },

  setDimMeasure: (id, measure) => {
    const dataset = get().dataset;
    set({
      dataset: {
        ...dataset,
        dimensions: dataset.dimensions.map((d) => (d.id === id ? { ...d, measure } : d)),
      },
    });
  },

  addFromCatalog: (keys) => {
    const dataset = get().dataset;
    const mat = materializeKeys(dataset, keys);
    if (!mat) {
      return { added: [], skipped: keys, error: "题组缓存已失效，请重新导入文件后再加入列。" };
    }
    const have = new Set(dataset.indicators.map((i) => i.key));
    const names = Object.fromEntries((dataset.catalog ?? []).map((c) => [c.key, c.name]));
    const fresh: IndicatorMeta[] = mat.added
      .filter((k) => !have.has(k))
      .map((key) => ({
        key,
        name: names[key] || key,
        direction: directionFromName(names[key] || key),
        dimensionId: null,
        selected: true,
        weight: 1,
      }));
    if (!fresh.length && !mat.added.length) return { added: [], skipped: mat.skipped };
    const dimId = dataset.dimensions[0]?.id ?? null;
    const indicators = [
      ...dataset.indicators,
      ...fresh.map((i) => ({ ...i, dimensionId: dimId })),
    ];
    set({ dataset: { ...dataset, rows: mat.rows, indicators } });
    return { added: mat.added, skipped: mat.skipped };
  },

  setIndicatorWeight: (key, weight) => {
    set({ dataset: patchInd(get().dataset, key, { weight }) });
  },

  normalizeLeafWeights: (dimId) => {
    const dataset = get().dataset;
    const members = dataset.indicators.filter((i) => i.selected && i.dimensionId === dimId);
    const s = members.reduce((a, i) => a + i.weight, 0);
    const wmap = new Map(
      members.map((i) => [i.key, s ? i.weight / s : 1 / members.length]),
    );
    set({
      dataset: {
        ...dataset,
        indicators: dataset.indicators.map((i) =>
          wmap.has(i.key) ? { ...i, weight: wmap.get(i.key)! } : i,
        ),
      },
    });
  },

  setMethod: (method) => set({ method }),
  setStandardize: (standardize) => set({ standardize }),
  setMissingMode: (missingMode) => set({ missingMode }),
  setTransform: (patch) => set({ transform: { ...get().transform, ...patch } }),
  setYearRange: (yearFrom, yearTo) => {
    if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
      set({ yearFrom: yearTo, yearTo: yearFrom, resultYear: null });
    } else {
      set({ yearFrom, yearTo, resultYear: null });
    }
  },
  setResultYear: (resultYear) => set({ resultYear }),
  setResultMode: (resultMode) => set({ resultMode, resultYear: resultMode === "mean" ? null : get().resultYear }),
  setHeatSelectedOnly: (heatSelectedOnly) => set({ heatSelectedOnly }),
  setFocusEntity: (focusEntity) => set({ focusEntity }),

  hydrate: (snap) =>
    set({
      step: snap.step,
      dataset: snap.dataset,
      thresholds: snap.thresholds,
      method: snap.method,
      standardize: snap.standardize,
      missingMode: snap.missingMode ?? "listwise",
      transform: {
        winsor: snap.transform?.winsor ?? 0,
        logMode: snap.transform?.logMode ?? "off",
      },
      yearFrom: snap.yearFrom ?? null,
      yearTo: snap.yearTo ?? null,
      resultYear: snap.resultYear ?? null,
      resultMode: snap.resultMode === "mean" ? "mean" : "latest",
      heatSelectedOnly: snap.heatSelectedOnly ?? false,
      focusEntity: null,
    }),

  snapshot: () => {
    const s = get();
    return {
      v: 1 as const,
      step: s.step,
      dataset: s.dataset,
      thresholds: s.thresholds,
      method: s.method,
      standardize: s.standardize,
      missingMode: s.missingMode,
      transform: s.transform,
      yearFrom: s.yearFrom,
      yearTo: s.yearTo,
      resultYear: s.resultYear,
      resultMode: s.resultMode,
      heatSelectedOnly: s.heatSelectedOnly,
    };
  },

  reset: () => set({ ...fromSnap(null), dataset: cloneDs(SAMPLE_DATASETS[0]!) }),
}));

export function useSlicedDataset(): Dataset {
  const ds = useStudio((s) => s.dataset);
  const yearFrom = useStudio((s) => s.yearFrom);
  const yearTo = useStudio((s) => s.yearTo);
  return useMemo(() => sliceByYear(ds, yearFrom, yearTo), [ds, yearFrom, yearTo]);
}
