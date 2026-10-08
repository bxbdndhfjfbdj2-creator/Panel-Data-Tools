import assert from "node:assert/strict";
import { test } from "node:test";
import { suggestConstructs, pruneCollinear, varimax } from "./construct.ts";
import { SAMPLE_DATASETS } from "./datasets.ts";

test("survey suggestion recovers multiple reflective scales", () => {
  const ds = SAMPLE_DATASETS.find((d) => d.kind === "survey")!;
  const s = suggestConstructs(ds);
  assert.equal(s.mode, "factor");
  assert.ok(s.constructs.length >= 3, `got ${s.constructs.length} constructs`);
  const keys = s.constructs.map((c) => c.members.map((m) => m.key[0]).join(""));
  const prefixes = s.constructs.map((c) => {
    const letters = c.members.map((m) => m.key.replace(/\d/g, ""));
    const mode = letters.sort()[Math.floor(letters.length / 2)];
    return { mode, letters };
  });
  const majorityOk = prefixes.filter((p) => p.letters.filter((x) => x === p.mode).length >= 3);
  assert.ok(majorityOk.length >= 3, JSON.stringify(prefixes));
  for (const c of s.constructs) {
    assert.ok(c.members.length >= 2);
    assert.ok(c.alpha == null || c.alpha > 0.6, `${c.name} alpha ${c.alpha}`);
  }
  const assigned = new Set(s.constructs.flatMap((c) => c.members.map((m) => m.key)));
  assert.equal(assigned.has("x1"), false);
  void keys;
});

test("panel suggestion splits into formative clusters", () => {
  const ds = SAMPLE_DATASETS.find((d) => d.kind === "panel")!;
  const s = suggestConstructs(ds);
  assert.equal(s.mode, "cluster");
  assert.ok(s.constructs.length >= 3, `got ${s.constructs.length}`);
  const all = s.constructs.flatMap((c) => c.members.map((m) => m.key));
  assert.ok(all.includes("gdppc"));
  const envish = s.constructs.find((c) =>
    c.members.some((m) => m.key === "pm" || m.key === "energy" || m.key === "forest"),
  );
  assert.ok(envish, "expected a green cluster");
  const envKeys = new Set(envish!.members.map((m) => m.key));
  assert.ok(envKeys.has("pm") || envKeys.has("energy"));
  const innov = s.constructs.find((c) => c.members.some((m) => m.key === "rd" || m.key === "patent"));
  assert.ok(innov, "expected an innovation cluster");
});

test("too few items yields leftover only", () => {
  const ds = structuredClone(SAMPLE_DATASETS[0]!);
  ds.indicators = ds.indicators.slice(0, 2).map((i) => ({ ...i, selected: true }));
  const s = suggestConstructs(ds);
  assert.equal(s.constructs.length, 0);
  assert.ok(s.notes[0]);
});

test("user-specified k is used for survey factors", () => {
  const ds = SAMPLE_DATASETS.find((d) => d.kind === "survey")!;
  const auto = suggestConstructs(ds);
  const two = suggestConstructs(ds, undefined, { k: 2 });
  assert.equal(two.usedK, 2);
  assert.ok(two.constructs.length <= 2);
  assert.ok(two.constructs.length >= 1);
  assert.ok(two.notes.some((n) => n.includes("指定 2")));
  const six = suggestConstructs(ds, undefined, { k: 6 });
  assert.equal(six.usedK, 6);
  assert.ok(auto.recommendedK >= 2);
});

test("user-specified k is used for panel clusters", () => {
  const ds = SAMPLE_DATASETS.find((d) => d.kind === "panel")!;
  const two = suggestConstructs(ds, undefined, { k: 2 });
  assert.equal(two.usedK, 2);
  assert.ok(two.constructs.length <= 2);
  assert.ok(two.constructs.some((c) => c.members.length >= 2));
});

test("pruneCollinear keeps at least two representatives", () => {
  const R = [
    [1, 0.99, 0.98, 0.1],
    [0.99, 1, 0.97, 0.12],
    [0.98, 0.97, 1, 0.08],
    [0.1, 0.12, 0.08, 1],
  ];
  const { keep, drop } = pruneCollinear([0, 1, 2, 3], R, { maxAbsCorr: 0.9, maxVif: 10, minKeep: 2 });
  assert.ok(keep.length >= 2);
  assert.ok(keep.includes(3), `independent item should stay, keep=${keep}`);
  assert.ok(drop.length >= 1);
  assert.ok(!drop.includes(3));
  assert.equal(keep.length + drop.length, 4);
});

test("singular pruning retains an independent variable at either end and after permutation", () => {
  const base = [
    [1, 1, 0.2],
    [1, 1, 0.2],
    [0.2, 0.2, 1],
  ];
  for (const order of [[0, 1, 2], [2, 0, 1], [1, 2, 0]]) {
    const R = order.map((i) => order.map((j) => base[i]![j]!));
    const independentPosition = order.indexOf(2);
    const { keep, drop } = pruneCollinear([0, 1, 2], R, { maxAbsCorr: 0.9, minKeep: 2 });
    assert.ok(keep.includes(independentPosition), `independent position lost for order ${order}`);
    assert.equal(drop.length, 1);
    assert.equal(keep.length, 2);
  }
});

test("singular pruning respects original IDs and removes multiple dependent directions", () => {
  const R: number[][] = Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 6 }, (_, j) => (i === j ? 1 : 0)),
  );
  for (const [a, b] of [[0, 1], [2, 4]] as const) {
    R[a]![b] = 1;
    R[b]![a] = 1;
  }
  // Duplicate columns have matching correlations with independent measures.
  for (const [dup, original, corr3, corr5] of [[1, 0, 0.2, 0.1], [4, 2, 0.15, 0.05]] as const) {
    R[dup]![3] = R[original]![3] = corr3;
    R[3]![dup] = R[3]![original] = corr3;
    R[dup]![5] = R[original]![5] = corr5;
    R[5]![dup] = R[5]![original] = corr5;
  }
  R[3]![5] = R[5]![3] = 0.05;

  const noncontiguous = pruneCollinear([2, 4, 5], R, { maxAbsCorr: 0.9, minKeep: 2 });
  assert.ok(noncontiguous.keep.includes(5));
  assert.equal(noncontiguous.drop.length, 1);

  const repeated = pruneCollinear([0, 1, 2, 3, 4, 5], R, { maxAbsCorr: 0.9, minKeep: 2 });
  assert.equal(repeated.keep.length, 4);
  assert.ok(repeated.keep.includes(3));
  assert.ok(repeated.keep.includes(5));
  assert.equal(repeated.drop.length, 2);
});

function varimaxObjective(loadings: number[][]): number {
  const p = loadings.length;
  const k = loadings[0]?.length ?? 0;
  let objective = 0;
  for (let j = 0; j < k; j++) {
    let fourth = 0;
    let squares = 0;
    for (let i = 0; i < p; i++) {
      const square = loadings[i]![j]! ** 2;
      squares += square;
      fourth += square ** 2;
    }
    objective += fourth - (squares * squares) / p;
  }
  return objective;
}

test("gamma=1 unnormalized Varimax does not lower its objective", () => {
  const loadings = [
    [0.62, 0.21, 0.18], [0.58, 0.24, 0.11], [0.51, 0.20, 0.27],
    [0.24, 0.67, 0.16], [0.19, 0.61, 0.23], [0.26, 0.54, 0.31],
    [0.18, 0.28, 0.70], [0.13, 0.19, 0.62], [0.27, 0.22, 0.57],
  ];
  const before = varimaxObjective(loadings);
  const rotated = varimax(loadings);
  assert.ok(varimaxObjective(rotated) >= before - 1e-12);
});

test("collinear construct flags only redundant copies", () => {
  const base = SAMPLE_DATASETS.find((d) => d.kind === "panel")!;
  const ds = structuredClone(base);
  ds.indicators = [
    { key: "a", name: "人均GDP", unit: "", direction: 1, dimensionId: null, selected: true, weight: 1 },
    { key: "a2", name: "人均GDP副本", unit: "", direction: 1, dimensionId: null, selected: true, weight: 1 },
    { key: "a3", name: "地区生产总值", unit: "", direction: 1, dimensionId: null, selected: true, weight: 1 },
    { key: "b", name: "研发强度", unit: "", direction: 1, dimensionId: null, selected: true, weight: 1 },
    { key: "c", name: "万人发明专利", unit: "", direction: 1, dimensionId: null, selected: true, weight: 1 },
  ];
  ds.rows = ds.rows.map((r) => {
    const a = Number(r.gdppc);
    return { ...r, a, a2: a + 0.02, a3: a * 1.01, b: Number(r.rd), c: Number(r.patent) };
  });
  const s = suggestConstructs(ds, undefined, { k: 2 });
  const members = s.constructs.flatMap((c) => c.members);
  const byKey = Object.fromEntries(members.map((m) => [m.key, m.flags]));
  const gdp = s.constructs.find((c) => c.members.some((m) => m.key === "a" || m.key === "a2" || m.key === "a3"));
  assert.ok(gdp, JSON.stringify(s.constructs.map((c) => c.members.map((m) => m.key))));
  const gdpKept = gdp!.members.filter((m) => !m.flags.includes("redundant"));
  const gdpDrop = gdp!.members.filter((m) => m.flags.includes("redundant"));
  assert.ok(gdpKept.length >= 2, `kept=${gdpKept.map((m) => m.key)}`);
  assert.ok(gdpDrop.length >= 1, `drop=${gdpDrop.map((m) => m.key)}`);
  assert.equal(gdpKept.length + gdpDrop.length, gdp!.members.length);
  assert.ok(!byKey.b?.includes("redundant"));
  assert.ok(!byKey.c?.includes("redundant"));
  assert.ok(s.notes.some((n) => n.includes("建议剔除")));
});

