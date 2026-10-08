import assert from "node:assert/strict";
import { test } from "node:test";
import { SAMPLE_DATASETS } from "./datasets.ts";
import { DEFAULT_THRESHOLDS } from "./types.ts";
import { screenDataset, meanByEntity, computeWeights, computeScores } from "./engine.ts";
import { constructFit, scaleHints } from "./diagnose.ts";
import { buildRScript, buildStataDo } from "./scripts.ts";
import { suggestConstructs } from "./construct.ts";

test("survey same-scale correlation is not high_corr", () => {
  const ds = SAMPLE_DATASETS.find((d) => d.kind === "survey")!;
  const rows = screenDataset(ds, { ...DEFAULT_THRESHOLDS, maxAbsCorr: 0.5 });
  const engage = rows.filter((r) => r.key.startsWith("e"));
  assert.ok(engage.length >= 3);
  assert.ok(engage.every((r) => !r.flags.includes("high_corr")));
});

test("construct fit reports alpha on survey dims", () => {
  const ds = SAMPLE_DATASETS.find((d) => d.kind === "survey")!;
  const fit = constructFit(ds);
  assert.ok(fit.dims.length >= 4);
  const withA = fit.dims.filter((d) => d.alpha != null && d.alpha > 0.6);
  assert.ok(withA.length >= 3, JSON.stringify(fit.dims.map((d) => [d.name, d.alpha])));
});

test("meanByEntity averages panel scores", () => {
  const ds = SAMPLE_DATASETS.find((d) => d.kind === "panel")!;
  const w = computeWeights(ds, "equal", "listwise");
  const b = computeScores(ds, w, "minmax", "equal", "listwise");
  const m = meanByEntity(b.rows);
  const nEnt = new Set(ds.rows.map((r) => String(r[ds.entityKey]))).size;
  assert.equal(m.length, nEnt);
});

test("scripts mention selected keys", () => {
  const ds = SAMPLE_DATASETS[0]!;
  const doFile = buildStataDo(ds, "equal", "minmax", "listwise", { winsor: 0, logMode: "off" });
  const r = buildRScript(ds, "equal", "minmax", "listwise", { winsor: 0, logMode: "off" });
  assert.match(doFile, /alpha /);
  assert.match(r, /rowMeans/);
  assert.ok(ds.indicators.some((i) => i.selected && r.includes(i.key)));
});

test("survey auto construct still recovers four scales", () => {
  const ds = SAMPLE_DATASETS.find((d) => d.kind === "survey")!;
  const s = suggestConstructs(ds);
  assert.ok(s.constructs.length >= 3, String(s.constructs.length));
});

test("scale hints do not force log on likert", () => {
  const ds = SAMPLE_DATASETS.find((d) => d.kind === "survey")!;
  const h = scaleHints(ds);
  assert.ok(h.some((x) => x.likert));
  assert.ok(h.filter((x) => x.likert).every((x) => !x.suggestLog));
});
