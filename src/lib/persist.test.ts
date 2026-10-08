import assert from "node:assert/strict";
import { test } from "node:test";
import { SAMPLE_DATASETS } from "./datasets.ts";
import { parseWorkspace, parseWorkspaceResult, WORKSPACE_KEY, writeWorkspace } from "./persist.ts";
import type { WorkspaceSnap, WorkspaceStorage } from "./persist.ts";
import { useStudio } from "./store.ts";

function makeSnapshot(): WorkspaceSnap {
  return {
    v: 1,
    savedAt: 1_700_000_000_000,
    step: "data",
    dataset: structuredClone(SAMPLE_DATASETS[0]!),
    thresholds: { maxMissing: 0.15, minCv: 0.04, maxAbsCorr: 0.9, maxVif: 10, minItemTotal: 0.3, maxFloorCeiling: 0.5 },
    method: "entropy",
    standardize: "minmax",
    missingMode: "listwise",
    transform: { winsor: 0, logMode: "off" },
    yearFrom: null,
    yearTo: null,
    resultYear: null,
    resultMode: "latest",
    heatSelectedOnly: false,
  };
}

test("workspace schema validates enums, finite values, uniqueness, and references", () => {
  const invalidCases: Array<[string, (snap: WorkspaceSnap) => void]> = [
    ["method enum", (snap) => { (snap as unknown as { method: string }).method = "unknown"; }],
    ["NaN cell", (snap) => { snap.dataset.rows[0]![Object.keys(snap.dataset.rows[0]!)[0]!] = Number.NaN; }],
    ["threshold infinity", (snap) => { snap.thresholds.maxVif = Number.POSITIVE_INFINITY; }],
    ["duplicate indicator key", (snap) => { snap.dataset.indicators.push({ ...snap.dataset.indicators[0]! }); }],
    ["duplicate dimension id", (snap) => { snap.dataset.dimensions.push({ ...snap.dataset.dimensions[0]! }); }],
    ["dangling dimension", (snap) => { snap.dataset.indicators[0]!.dimensionId = "missing-dimension"; }],
    ["negative weight", (snap) => { snap.dataset.dimensions[0]!.weight = -0.2; }],
    ["invalid transform", (snap) => { snap.transform = { winsor: 0.02 as 0, logMode: "ln" }; }],
    ["explicit null transform", (snap) => { (snap as unknown as { transform: unknown }).transform = { winsor: null, logMode: "off" }; }],
    ["explicit null missing mode", (snap) => { (snap as unknown as { missingMode: unknown }).missingMode = null; }],
    ["fractional year", (snap) => { snap.yearFrom = 2020.5; }],
    ["reversed year range", (snap) => { snap.yearFrom = 2022; snap.yearTo = 2020; }],
  ];

  for (const [label, corrupt] of invalidCases) {
    const snap = makeSnapshot();
    corrupt(snap);
    const result = parseWorkspaceResult(snap);
    assert.equal(result.ok, false, label);
    if (!result.ok) assert.match(result.error, /方案校验失败/);
    assert.equal(parseWorkspace(snap), null, label);
  }
});

test("workspace schema rejects empty or duplicate catalog keys and unresolved idKey", () => {
  const catalogItem = (key: string) => ({ key, name: key || "未命名", fill: 1, battery: "", nUnique: 1 });
  const existingColumn = Object.keys(makeSnapshot().dataset.rows[0]!)[0]!;
  const cases: Array<[string, (snap: WorkspaceSnap) => void]> = [
    ["empty catalog key", (snap) => { snap.dataset.catalog = [catalogItem("")]; }],
    ["duplicate catalog key", (snap) => { snap.dataset.catalog = [catalogItem(existingColumn), catalogItem(existingColumn)]; }],
    ["unresolved catalog key", (snap) => { snap.dataset.catalog = [catalogItem("absent_catalog_column")]; }],
    ["unresolved idKey", (snap) => { snap.dataset.idKey = "absent"; }],
    ["empty idKey", (snap) => { snap.dataset.idKey = "  "; }],
  ];
  for (const [label, corrupt] of cases) {
    const snap = makeSnapshot();
    corrupt(snap);
    const result = parseWorkspaceResult(snap);
    assert.equal(result.ok, false, label);
  }
});

test("workspace schema defaults optional legacy fields explicitly", () => {
  const oldSnap = makeSnapshot() as unknown as Record<string, unknown>;
  delete oldSnap.missingMode;
  delete oldSnap.transform;
  delete oldSnap.yearFrom;
  delete oldSnap.yearTo;
  delete oldSnap.resultYear;
  delete oldSnap.resultMode;
  delete oldSnap.heatSelectedOnly;
  const parsed = parseWorkspace(oldSnap);
  assert.ok(parsed);
  assert.equal(parsed.missingMode, "listwise");
  assert.deepEqual(parsed.transform, { winsor: 0, logMode: "off" });
  assert.equal(parsed.yearFrom, null);
  assert.equal(parsed.yearTo, null);
  assert.equal(parsed.resultYear, null);
  assert.equal(parsed.resultMode, "latest");
  assert.equal(parsed.heatSelectedOnly, false);
});

test("store hydrate accepts old optional-field snapshots and ignores invalid snapshots", () => {
  const oldSnap = makeSnapshot() as unknown as Record<string, unknown>;
  delete oldSnap.missingMode;
  delete oldSnap.transform;
  delete oldSnap.yearFrom;
  delete oldSnap.yearTo;
  delete oldSnap.resultYear;
  delete oldSnap.resultMode;
  delete oldSnap.heatSelectedOnly;

  useStudio.getState().hydrate(oldSnap as unknown as WorkspaceSnap);
  const state = useStudio.getState();
  assert.equal(state.missingMode, "listwise");
  assert.deepEqual(state.transform, { winsor: 0, logMode: "off" });
  assert.equal(state.yearFrom, null);
  assert.equal(state.resultMode, "latest");
  const before = state.snapshot();

  const invalid = makeSnapshot();
  (invalid as unknown as { step: string }).step = "invalid";
  useStudio.getState().hydrate(invalid);
  assert.deepEqual(useStudio.getState().snapshot(), before);
});

test("workspace write reports unavailable storage and storage exceptions without success time", () => {
  const snap = makeSnapshot();
  const unavailable = writeWorkspace(snap, null);
  assert.equal(unavailable.ok, false);

  const throwingStorage: WorkspaceStorage = {
    setItem() { throw new Error("quota"); },
  };
  const failed = writeWorkspace(snap, throwingStorage);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.match(failed.error, /存储空间不足或写入失败/);
});

test("workspace write reports successful storage only after setItem completes", () => {
  const snap = makeSnapshot();
  let writtenKey = "";
  let writtenValue = "";
  const storage: WorkspaceStorage = {
    setItem(key, value) {
      writtenKey = key;
      writtenValue = value;
    },
  };
  const result = writeWorkspace(snap, storage);
  assert.deepEqual(result, { ok: true, savedAt: snap.savedAt });
  assert.equal(writtenKey, WORKSPACE_KEY);
  assert.equal(JSON.parse(writtenValue).savedAt, snap.savedAt);
});

test("workspace write reports serialization failure", () => {
  const snap = makeSnapshot();
  (snap.dataset as unknown as Record<string, unknown>).cycle = snap.dataset;
  let attemptedWrite = false;
  const storage: WorkspaceStorage = { setItem() { attemptedWrite = true; } };
  const result = writeWorkspace(snap, storage);
  assert.equal(result.ok, false);
  assert.equal(attemptedWrite, false);
  if (!result.ok) assert.match(result.error, /序列化失败/);
});
