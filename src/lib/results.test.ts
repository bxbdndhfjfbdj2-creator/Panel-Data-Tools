import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dataset } from "./types.ts";
import { computeScores, computeWeights, crossMethodAnalysis, leaveOneOutInfluence, selectResultRows } from "./engine.ts";
import { bootstrapIntervals, yearStability } from "./diagnose.ts";
import { actualLatestYear, buildAnalysisContext, describeActualYears, numericYears, resultPeriodLabel, resultViewDescription } from "./slice.ts";
import { allocateExportFilename, buildMarkdownReport, claimSessionExportFilename, markdownText, stableDataHash } from "./report.ts";
import { DEFAULT_THRESHOLDS } from "./types.ts";

function panelFixture(): Dataset {
  const rows = Array.from({ length: 6 }, (_, i) => [
    { id: `e${i}`, year: 2020, group: "A|one", x1: i + 1, x2: 7 - i, x3: i % 2 },
    { id: `e${i}`, year: 2021, group: "A|one", x1: i + 2, x2: 8 - i, x3: (i + 1) % 2 },
    { id: `e${i}`, year: null, group: "A|one", x1: 99, x2: 99, x3: 0 },
  ]).flat();
  return {
    id: "result-fixture", name: "fixture", kind: "panel", description: "", sourceNote: "source|note",
    rows, entityKey: "id", timeKey: "year", groupKey: "group",
    indicators: [
      { key: "x1", name: "X|one", direction: 1, dimensionId: "d1", selected: true, weight: 0.5 },
      { key: "x2", name: "X two", direction: 1, dimensionId: "d1", selected: true, weight: 0.5 },
      { key: "x3", name: "X three", direction: 1, dimensionId: "d1", selected: true, weight: 0 },
    ],
    dimensions: [{ id: "d1", name: "D|one", weight: 1 }], goalName: "Goal|A",
  };
}

test("analysis context uses one year window and never treats null time as year zero", () => {
  const source = panelFixture();
  assert.deepEqual(numericYears(source), [2020, 2021]);
  const context = buildAnalysisContext(source, 2020, 2021, "latest", null);
  assert.equal(context.dataset.rows.length, 12);
  assert.equal(context.latestYear, 2021);
  assert.equal(context.view.mode, "latest");
  assert.equal(context.entities, 6);
  assert.ok(context.dataset.rows.every((row) => row.year !== null));

  const nullOnly: Dataset = { ...source, rows: source.rows.filter((row) => row.year === null) };
  assert.deepEqual(numericYears(nullOnly), []);
  assert.equal(buildAnalysisContext(nullOnly, null, null, "latest", null).latestYear, null);

  const unavailableYear = buildAnalysisContext(source, 2020, 2021, "latest", 2022);
  assert.deepEqual(unavailableYear.actualYears, [2020, 2021]);
  assert.deepEqual(unavailableYear.view, { mode: "latest", year: null });
});

test("ranking period labels distinguish actual observations, period means, and survey rows", () => {
  assert.equal(resultPeriodLabel("panel", { mode: "latest", year: null }, 2021), "2021 年");
  assert.equal(resultPeriodLabel("panel", { mode: "year", year: 2020 }, 2020), "2020 年");
  assert.equal(resultPeriodLabel("panel", { mode: "mean", year: null }, null), "时期均值");
  assert.equal(resultPeriodLabel("panel", { mode: "latest", year: null }, null), "无时间");
  assert.equal(resultPeriodLabel("survey", { mode: "latest", year: null }, null), "无时间");
  assert.equal(resultViewDescription("panel", { mode: "latest", year: null }, 2021), "各实体最新实际观测（最新实际年份 2021；各实体年份可能不同）");
  assert.equal(resultViewDescription("panel", { mode: "year", year: 2020 }, 2021), "指定年份 2020");
  assert.equal(resultViewDescription("panel", { mode: "mean", year: null }, 2021), "所选时期内个体均值");
  assert.equal(resultViewDescription("survey", { mode: "latest", year: null }, null), "问卷样本得分");
  assert.equal(describeActualYears([]), "无有效年份");
  assert.equal(describeActualYears([2020, 2021, 2022]), "2020–2022（连续，共 3 年）");
  assert.equal(describeActualYears([2020, 2022]), "2020、2022（非连续，共 2 个实际年份）");
});

test("latest actual year scans large datasets without spreading an array into Math.max", () => {
  const ds: Dataset = {
    ...panelFixture(),
    rows: Array.from({ length: 150_000 }, (_, year) => ({ year })),
  };
  assert.equal(actualLatestYear(ds), 149_999);
});

test("selected-year and period-mean views select the same scores used by downstream analysis", () => {
  const ds = panelFixture();
  const weights = computeWeights(ds, "equal");
  const scored = computeScores(ds, weights, "minmax", "equal");
  const year = selectResultRows(scored.rows, { mode: "year", year: 2020 });
  const mean = selectResultRows(scored.rows, { mode: "mean", year: null });
  assert.equal(year.length, 6);
  assert.ok(year.every((row) => row.time === 2020));
  assert.equal(mean.length, 6);
  assert.ok(mean.every((row) => row.time === null));
  assert.notDeepEqual(year.map((row) => row.composite), mean.map((row) => row.composite));
  assert.deepEqual(yearStability(ds, weights, "minmax", "equal", "listwise")?.years, [2020, 2021]);
  const specified = crossMethodAnalysis(ds, "minmax", ["equal", "entropy"], "listwise", { winsor: 0, logMode: "off" }, { mode: "year", year: 2020 });
  const latest = crossMethodAnalysis(ds, "minmax", ["equal", "entropy"], "listwise", { winsor: 0, logMode: "off" }, { mode: "latest", year: null });
  assert.notDeepEqual(specified.scores.equal, latest.scores.equal);
  const looSpecified = leaveOneOutInfluence(ds, "equal", "minmax", "listwise", { winsor: 0, logMode: "off" }, { mode: "year", year: 2020 });
  const looLatest = leaveOneOutInfluence(ds, "equal", "minmax", "listwise", { winsor: 0, logMode: "off" }, { mode: "latest", year: null });
  assert.notDeepEqual(looSpecified, looLatest);
});

test("resampling sensitivity reports deterministic B and explicit disabled reasons", () => {
  const ds = panelFixture();
  const weights = computeWeights(ds, "equal");
  const args = [ds, weights, "minmax", "equal", "listwise", { winsor: 0, logMode: "off" }, Array.from({ length: 6 }, (_, i) => `e${i}`), 12, 77] as const;
  const first = bootstrapIntervals(...args);
  const second = bootstrapIntervals(...args);
  assert.equal(first.status, "active");
  assert.equal(first.requestedB, 12);
  assert.equal(first.effectiveB, 12);
  assert.equal(first.seed, 77);
  assert.deepEqual(first.ranges, second.ranges);

  const tooFew = bootstrapIntervals(ds, weights, "minmax", "equal", "listwise", { winsor: 0, logMode: "off" }, ["e1", "e2"], 12);
  assert.equal(tooFew.status, "disabled");
  assert.equal(tooFew.reason, "too_few_entities");
  const invalid = bootstrapIntervals(ds, weights, "minmax", "equal", "listwise", { winsor: 0, logMode: "off" }, ["e1"], 0);
  assert.equal(invalid.reason, "invalid_repetitions");
});

test("report captures actual run context, escapes table text, and separates full from window counts", () => {
  const source = panelFixture();
  const current = {
    ...source,
    rows: source.rows.filter((row) => row.year === 2021),
    dimensions: source.dimensions.map((dim) => ({ ...dim, weight: 4 })),
    indicators: source.indicators.map((ind) => ind.key === "x1" ? { ...ind, direction: -1 as const, weight: 0.8, logMode: "log1p" as const } : ind.key === "x2" ? { ...ind, weight: 0.2 } : ind),
  };
  current.weightKey = "weight|_key";
  const weights = computeWeights(current, "equal");
  const bundle = computeScores(current, weights, "minmax", "equal");
  const report = buildMarkdownReport({
    dataset: current, sourceDataset: source, method: "equal", standardize: "minmax", missingMode: "listwise",
    transform: { winsor: 0.05, logMode: "ln" }, yearFrom: 2021, yearTo: 2021,
    thresholds: { ...DEFAULT_THRESHOLDS, maxMissing: 0.2, minCv: 0.03 },
    screen: [], weights: { ...weights, notes: ["note | with _emphasis"] }, ranking: bundle.rows, kmo: null, dropped: 0, alpha: null,
    view: { mode: "year", year: 2021 },
    sensitivity: { ranges: { e0: { lo: 12, hi: 18 } }, requestedB: 36, effectiveB: 29, seed: 2026, status: "active" },
  });
  assert.match(report, /全量观测：18 行/);
  assert.match(report, /观测：6 行/);
  assert.match(report, /method=equal; standardize=minmax; missing=listwise; transform=winsor=0\.05, logMode=ln/);
  const runId = report.match(/运行 ID：([0-9a-f]{16})/)?.[1];
  assert.ok(runId);
  const payloadJson = report.match(/```json\n([\s\S]*?)\n```/)?.[1];
  assert.ok(payloadJson);
  const hashPayload = JSON.parse(payloadJson) as {
    selected: { key: string; direction: number; logMode: string; weight: number; dimensionId: string }[];
    dimensions: { id: string; name: string; weight: number }[];
    datasetRoles: { kind: string; entityKey: string; timeKey: string | null; groupKey: string | null; weightKey: string | null; idKey: string | null };
  };
  assert.equal(stableDataHash(hashPayload), runId);
  assert.deepEqual(hashPayload.selected.find((i) => i.key === "x1"), { key: "x1", direction: -1, logMode: "log1p", weight: 0.8, dimensionId: "d1" });
  assert.deepEqual(hashPayload.dimensions.find((d) => d.id === "d1"), { id: "d1", name: "D|one", weight: 4 });
  assert.deepEqual(hashPayload.datasetRoles, { kind: "panel", entityKey: "id", timeKey: "year", groupKey: "group", weightKey: "weight|_key", idKey: null });
  assert.match(payloadJson, /"maxMissing": 0\.2/);
  assert.match(payloadJson, /"minCv": 0\.03/);
  assert.match(report, /指定年份 2021/);
  assert.match(report, /当前数据实际年份：2021–2021（连续，共 1 年）/);
  assert.ok(report.includes("抽样权重列：weight\\|\\_key"));
  assert.ok(report.includes("note \\| with \\_emphasis"));
  assert.match(report, /指定年份 2021/);
  assert.match(report, /X\\\|one/);
  assert.match(report, /A\\\|one/);
  assert.match(report, /有效 B=29/);
  assert.match(report, /不是完整置信区间/);
  assert.match(report, /维度权重（dimension id \/ name \/ 配置 weight → 实际计算权重）：d1 \/ D\\\|one：4\.000000 → 1\.000000/);
  assert.match(report, /指标权重（key \/ dimensionId \/ 配置 weight → 维内实际权重 → 全局实际权重）：x1 \/ d1：0\.800000 → 0\.333333 → 0\.333333/);
  assert.match(report, /筛选阈值：最大缺失率 20\.0%/);
  assert.match(report, /x1：负向；logMode=指标覆盖（log1p）/);
  assert.match(report, /x2：正向；logMode=继承全局（ln）/);
  assert.equal(markdownText("a|b\nc"), "a\\|b<br>c");
});

test("latest-view report lists each entity's actual observation year", () => {
  const source = panelFixture();
  const dataset = {
    ...source,
    rows: source.rows.filter((row) =>
      (row.id === "e0" && row.year === 2020) || (row.id === "e1" && row.year === 2021)),
  };
  const weights = computeWeights(dataset, "equal");
  const scored = computeScores(dataset, weights, "minmax", "equal");
  const ranking = selectResultRows(scored.rows, { mode: "latest", year: null });
  const report = buildMarkdownReport({
    dataset,
    method: "equal",
    standardize: "minmax",
    missingMode: "listwise",
    yearFrom: null,
    yearTo: null,
    thresholds: DEFAULT_THRESHOLDS,
    screen: [],
    weights,
    ranking,
    kmo: null,
    dropped: 0,
    alpha: null,
    view: { mode: "latest", year: null },
  });
  assert.match(report, /\| 排名 \| 名称 \| 观测期 \| 综合指数 \| 分组 \|/);
  assert.ok(report.includes("| e0 | 2020 年 |"));
  assert.ok(report.includes("| e1 | 2021 年 |"));
});

test("report hash changes when direction, indicator log override, or screening thresholds change", () => {
  const ds = panelFixture();
  const reportHash = (dataset: Dataset, thresholds = DEFAULT_THRESHOLDS) => {
    const weights = computeWeights(dataset, "equal");
    const ranking = computeScores(dataset, weights, "minmax", "equal").rows;
    const report = buildMarkdownReport({
      dataset, method: "equal", standardize: "minmax", missingMode: "listwise",
      transform: { winsor: 0, logMode: "off" }, yearFrom: null, yearTo: null,
      thresholds, screen: [], weights, ranking, kmo: null, dropped: 0, alpha: null,
    });
    return report.match(/运行 ID：([0-9a-f]{16})/)?.[1];
  };
  const base = reportHash(ds);
  assert.ok(base);
  const reversed = { ...ds, indicators: ds.indicators.map((ind) => ind.key === "x1" ? { ...ind, direction: -1 as const } : ind) };
  const transformed = { ...ds, indicators: ds.indicators.map((ind) => ind.key === "x1" ? { ...ind, logMode: "ln" as const } : ind) };
  const reweighted = { ...ds, indicators: ds.indicators.map((ind) => ind.key === "x1" ? { ...ind, weight: 0.8000001 } : ind) };
  const dimensioned = {
    ...ds,
    dimensions: [...ds.dimensions, { id: "d2", name: "D2", weight: 0.4 }],
    indicators: ds.indicators.map((ind) => ind.key === "x1" ? { ...ind, dimensionId: "d2" } : ind),
  };
  const roleVariants: Dataset[] = [
    { ...ds, kind: "survey" },
    { ...ds, entityKey: "group" },
    { ...ds, timeKey: "group" },
    { ...ds, groupKey: "year" },
    { ...ds, weightKey: "x1" },
    { ...ds, idKey: "group" },
  ];
  assert.notEqual(reportHash(reversed), base);
  assert.notEqual(reportHash(transformed), base);
  assert.notEqual(reportHash(reweighted), base);
  assert.notEqual(reportHash(dimensioned), base);
  for (const changedRoles of roleVariants) assert.notEqual(reportHash(changedRoles), base);
  assert.notEqual(reportHash(ds, { ...DEFAULT_THRESHOLDS, maxAbsCorr: 0.42 }), base);

  const preciseThresholdReport = (() => {
    const weights = computeWeights(ds, "equal");
    return buildMarkdownReport({
      dataset: ds, method: "equal", standardize: "minmax", missingMode: "listwise",
      transform: { winsor: 0, logMode: "off" }, yearFrom: null, yearTo: null,
      thresholds: { ...DEFAULT_THRESHOLDS, maxMissing: 0.1234567 }, screen: [], weights,
      ranking: computeScores(ds, weights, "minmax", "equal").rows, kmo: null, dropped: 0, alpha: null,
    });
  })();
  assert.match(preciseThresholdReport, /"maxMissing": 0\.1234567/);
  assert.match(preciseThresholdReport, /"weight": 0\.5[\s\S]*"dimensionId": "d1"/);
});

test("export filenames are safe and deterministically de-duplicated", () => {
  const first = allocateExportFilename("指标/目标: A", "csv", []);
  assert.equal(first, "指标_目标_ A.csv");
  assert.equal(allocateExportFilename("指标/目标: A", "csv", [first]), "指标_目标_ A (2).csv");
  assert.equal(allocateExportFilename("...", "md", []), "export.md");

  // An empty persisted list models unavailable/failed localStorage; in-session claims still advance.
  const inSession = new Set<string>();
  assert.equal(claimSessionExportFilename("report", "md", [], inSession), "report.md");
  assert.equal(claimSessionExportFilename("report", "md", [], inSession), "report (2).md");
  assert.equal(claimSessionExportFilename("report", "md", ["report.md", "report (2).md"], inSession), "report (3).md");
});
