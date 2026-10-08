import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dataset } from "./types.ts";
import { computeScores, computeWeights, crossMethodAnalysis, meanByEntity, screenDataset } from "./engine.ts";
import { DEFAULT_THRESHOLDS } from "./types.ts";

function fixture(values: number[][], panel = false): Dataset {
  const indicators = values.map((_, i) => ({
    key: `x${i + 1}`,
    name: `X${i + 1}`,
    direction: 1 as const,
    dimensionId: "d1",
    selected: true,
    weight: 1 / values.length,
  }));
  const rows = values[0]!.map((_, r) => ({
    id: `e${panel ? Math.floor(r / 2) : r}`,
    year: r,
    ...Object.fromEntries(values.map((col, i) => [`x${i + 1}`, col[r]!])),
  }));
  return {
    id: "fixture", name: "fixture", kind: panel ? "panel" : "survey", description: "", sourceNote: "",
    rows, entityKey: "id", ...(panel ? { timeKey: "year" } : {}), indicators,
    dimensions: [{ id: "d1", name: "D1", weight: 1 }], goalName: "score",
  };
}

function near(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: got ${actual}, expected ${expected}`);
}

test("median and 10% trimmed methods use the documented hand calculations", () => {
  const ds = fixture([[0, 0, 1], [0.25, 0, 1], [0.5, 0, 1], [1, 0, 1]]);
  const medianScores = computeScores(ds, computeWeights(ds, "median"), "minmax", "median");
  const trimmedScores = computeScores(ds, computeWeights(ds, "trimmed"), "minmax", "trimmed");
  near(medianScores.rows[0]!.composite, 37.5, "median of [0,.25,.5,1]");
  near(trimmedScores.rows[0]!.composite, 43.75, "10% trimmed mean with n=4 keeps all four values");
});

test("TOPSIS pairwise equals listwise on complete data and closeness stays in [0,1]", () => {
  const ds = fixture([[1, 2, 4, 5], [5, 4, 2, 1]]);
  const byListwise = computeScores(ds, computeWeights(ds, "topsis", "listwise"), "minmax", "topsis", "listwise");
  const byPairwise = computeScores(ds, computeWeights(ds, "topsis", "pairwise"), "minmax", "topsis", "pairwise");
  assert.deepEqual(byPairwise.rows.map((r) => r.composite), byListwise.rows.map((r) => r.composite));
  assert.ok(byPairwise.rows.every((r) => r.closeness != null && r.closeness >= 0 && r.closeness <= 1));
});

test("TOPSIS rejects true pairwise missingness and cross-method reports the skipped method", () => {
  const ds = fixture([[1, null as unknown as number, 4, 5], [5, 4, 2, 1]]);
  const weights = computeWeights(ds, "topsis", "pairwise");
  assert.match(weights.error ?? "", /TOPSIS/);
  const scores = computeScores(ds, weights, "minmax", "topsis", "pairwise");
  assert.match(scores.error ?? "", /TOPSIS/);
  const cross = crossMethodAnalysis(ds, "minmax", ["equal", "topsis"], "pairwise");
  assert.ok(cross.methods.includes("equal"));
  assert.match(cross.skipped.topsis ?? "", /TOPSIS/);
});

test("zero-weight empty dimensions stay empty while active dimensions get an equal fallback", () => {
  const ds = fixture([[0, 1, 2], [2, 1, 0]]);
  ds.dimensions.push({ id: "empty", name: "Empty", weight: 0 });
  ds.indicators[0]!.dimensionId = "d1";
  ds.indicators[1]!.dimensionId = "d1";
  ds.dimensions[0]!.weight = 0;
  const weights = computeWeights(ds, "equal");
  near(weights.dimension.d1!, 1, "active dimension fallback");
  near(weights.dimension.empty!, 0, "empty dimension remains weightless");
  const scores = computeScores(ds, weights, "minmax", "equal");
  assert.ok(scores.rows.length > 0);
});

test("additive contributions plus the explicit intercept equal scores after standardization and entity means", () => {
  const ds = fixture([[1, 2, 3, 4], [4, 3, 2, 1], [1, 3, 2, 4]], true);
  for (const standardize of ["minmax", "zscore"] as const) {
    const weights = computeWeights(ds, "equal");
    const scored = computeScores(ds, weights, standardize, "equal");
    for (const row of scored.rows) {
      near(Object.values(row.contributions ?? {}).reduce((a, b) => a + b, 0) + (row.contributionIntercept ?? 0), row.composite, `${standardize} row decomposition`);
    }
    for (const row of meanByEntity(scored.rows)) {
      near(Object.values(row.contributions ?? {}).reduce((a, b) => a + b, 0) + (row.contributionIntercept ?? 0), row.composite, `${standardize} period mean decomposition`);
      near(Number(row.metadata?.year), row.entity === "e0" ? 0.5 : 2.5, "period metadata numeric mean");
      assert.equal(row.metadata?.id, row.entity);
    }
  }
});

test("pairwise additive contributions remain exact with row-specific available weights", () => {
  const ds = fixture([
    [1, null as unknown as number, 3, 4],
    [4, 3, null as unknown as number, 1],
    [2, 4, 3, null as unknown as number],
  ]);
  const weights = computeWeights(ds, "equal", "pairwise");
  for (const standardize of ["minmax", "zscore"] as const) {
    const bundle = computeScores(ds, weights, standardize, "equal", "pairwise");
    assert.ok(bundle.rows.length > 0);
    for (const row of bundle.rows) {
      near(Object.values(row.contributions ?? {}).reduce((a, b) => a + b, 0) + (row.contributionIntercept ?? 0), row.composite, `pairwise ${standardize} decomposition`);
    }
  }
});

test("80-column screening computes observed correlations instead of substituting an identity matrix", () => {
  const cols = Array.from({ length: 80 }, (_, j) => [0, 1, 2, 3, 4, 5].map((v) => v * (1 + (j % 4)) + (j % 4)));
  const ds = fixture(cols);
  const screen = screenDataset(ds, DEFAULT_THRESHOLDS);
  assert.equal(screen.length, 80);
  assert.ok(screen[0]!.maxCorr);
  assert.ok(Math.abs(screen[0]!.maxCorr!.r) > 0.99);
});

test("indicator log overrides feed the shared screening transform", () => {
  const ds = fixture([[1, Math.E, Math.E ** 2], [1, 2, 3]]);
  ds.indicators[0]!.logMode = "ln";
  const rows = screenDataset(ds, DEFAULT_THRESHOLDS, { winsor: 0, logMode: "off" });
  near(rows[0]!.mean, 1, "indicator-level ln override");
});

test("PCA variance summary is unchanged when dimension iteration order changes", () => {
  const ds = fixture([
    [0, 1, 2, 3, 4],
    [1, 2, 1, 3, 2],
    [3, 2, 4, 1, 0],
    [0, 2, 1, 4, 3],
    [4, 3, 2, 1, 0],
    [2, 0, 3, 2, 4],
  ]);
  ds.indicators[2]!.dimensionId = "d2";
  ds.indicators[3]!.dimensionId = "d2";
  ds.indicators[4]!.dimensionId = "d3";
  ds.indicators[5]!.dimensionId = "d3";
  ds.dimensions.push(
    { id: "d2", name: "D2", weight: 1 },
    { id: "d3", name: "D3", weight: 1 },
  );
  const original = computeWeights(ds, "pca").pcaVariance;
  const reversed = computeWeights({ ...ds, dimensions: [...ds.dimensions].reverse() }, "pca").pcaVariance;
  near(original!, reversed!, "PCA summary order invariance");
});

test("invalid weights are rejected before score calculation", () => {
  const ds = fixture([[0, 1, 2], [2, 1, 0]]);
  ds.dimensions[0]!.weight = Number.NaN;
  assert.match(computeWeights(ds, "equal").error ?? "", /有限的非负数/);
  ds.dimensions[0]!.weight = 1;
  ds.indicators[0]!.weight = -1;
  assert.match(computeWeights(ds, "equal").error ?? "", /有限的非负数/);
});

test("score metadata keeps only analysis role fields", () => {
  const ds = fixture([[0, 1, 2], [2, 1, 0]], true);
  ds.rows[0]!.private_note = "do not copy";
  const row = computeScores(ds, computeWeights(ds, "equal"), "minmax", "equal").rows[0]!;
  assert.equal(row.metadata?.id, "e0");
  assert.equal(row.metadata?.year, 0);
  assert.equal(row.metadata?.private_note, undefined);
});

test("formative survey indicators do not receive reflective alpha screening flags", () => {
  const ds = fixture([[1, 2, 3, 4, 5, 6, 7, 8], [2, 4, 6, 8, 10, 12, 14, 16]]);
  ds.dimensions[0]!.measure = "formative";
  const rows = screenDataset(ds, { ...DEFAULT_THRESHOLDS, minItemTotal: 0.99 });
  assert.ok(rows.every((r) => r.itemTotal == null));
  assert.ok(rows.every((r) => !r.flags.includes("low_item_total") && !r.flags.includes("hurts_alpha")));
});

