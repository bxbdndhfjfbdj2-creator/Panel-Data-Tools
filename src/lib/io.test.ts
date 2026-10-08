import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseDta } from "./dta.ts";
import { datasetFromDta, datasetFromSpreadsheet } from "./io.ts";
import { computeScores, computeWeights, groupMeans, screenDataset } from "./engine.ts";
import { applyTransform, quantile, samplingWeights, weightedMean, winsorize } from "./transform.ts";
import { SAMPLE_DATASETS } from "./datasets.ts";

test("winsorize clips tails", () => {
  const col = Array.from({ length: 100 }, (_, i) => i + 1);
  const w = winsorize(col, 0.05);
  const xs = w.filter((x): x is number => x != null);
  assert.equal(quantile(xs, 0), quantile(col as number[], 0.05));
  assert.ok(Math.max(...xs) <= quantile(col as number[], 0.95) + 1e-9);
});

test("log skips mostly non-positive columns", () => {
  const col = [-2, -1, 0, 1, 2];
  const r = applyTransform(col, { winsor: 0, logMode: "ln" });
  assert.equal(r.skippedLog, true);
  assert.deepEqual(r.col, col);
});

test("ln maps positive values", () => {
  const col = [1, Math.E, Math.E ** 2];
  const r = applyTransform(col, { winsor: 0, logMode: "ln" });
  assert.equal(r.skippedLog, false);
  assert.ok(Math.abs((r.col[1] as number) - 1) < 1e-9);
});

test("weighted mean matches hand calc", () => {
  const xs = [1, 2, 3];
  const w = [1, 1, 2];
  assert.equal(weightedMean(xs, w), 2.25);
});

test("dta reader parses CFPS county match file", () => {
  const buf = readFileSync("/workspace/artifacts/survey/cfps/顺序码匹配.dta");
  const table = parseDta(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(table.nObs, 162);
  assert.equal(table.nVar, 6);
  assert.ok(table.headers.includes("provname"));
  assert.equal(typeof table.rows[0]?.countyid, "number");
  assert.ok(String(table.rows[0]?.provname ?? "").length > 0);
});

test("dta import becomes a dataset", () => {
  const buf = readFileSync("/workspace/artifacts/survey/cfps/顺序码匹配.dta");
  const ds = datasetFromDta(
    "顺序码匹配.dta",
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  assert.ok(ds.rows.length === 162);
  assert.ok(ds.entityKey);
});

test("xlsx import reads CGSS 2017 codebook", async () => {
  const buf = readFileSync("/workspace/artifacts/survey/cgss/cgss2017代码表.xls");
  const ds = await datasetFromSpreadsheet(
    "cgss2017代码表.xls",
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  assert.ok(ds.rows.length > 10);
  assert.ok(ds.indicators.length + Object.keys(ds.rows[0] ?? {}).length > 0);
});

test("engine scores include weight 1 by default", () => {
  const ds = SAMPLE_DATASETS[0]!;
  const w = computeWeights(ds, "equal");
  const b = computeScores(ds, w, "minmax", "equal");
  assert.ok(b.rows.length > 0);
  assert.equal(b.rows[0]?.weight, 1);
});

test("group means weight by sampling weight", () => {
  const ds = structuredClone(SAMPLE_DATASETS[0]!);
  ds.weightKey = "__w";
  ds.rows = ds.rows.map((r, i) => ({ ...r, __w: i % 2 === 0 ? 3 : 1 }));
  const w = computeWeights(ds, "entropy", "listwise");
  const b = computeScores(ds, w, "minmax", "entropy");
  const g = groupMeans(b.rows);
  assert.ok(g[0]?.weighted);
  assert.ok((g[0]?.nEff ?? 0) > 0);
});

test("screen uses transform", () => {
  const ds = SAMPLE_DATASETS[0]!;
  const raw = screenDataset(ds, { maxMissing: 1, minCv: 0, maxAbsCorr: 1, maxVif: 99, minItemTotal: 0, maxFloorCeiling: 1 });
  const logged = screenDataset(
    ds,
    { maxMissing: 1, minCv: 0, maxAbsCorr: 1, maxVif: 99, minItemTotal: 0, maxFloorCeiling: 1 },
    { winsor: 0.01, logMode: "ln" },
  );
  assert.equal(raw.length, logged.length);
});

test("samplingWeights zeros nonpositive", () => {
  const rows = [{ w: 2 }, { w: 0 }, { w: -1 }, { w: null }];
  assert.deepEqual(samplingWeights(rows, "w"), [2, 0, 0, 0]);
});
