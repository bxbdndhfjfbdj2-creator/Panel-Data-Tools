import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseDta } from "./dta.ts";
import { datasetFromDta, datasetFromSpreadsheet } from "./io.ts";
import { datasetFromCsv, datasetFromParsed } from "./csv.ts";
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

test("Stata reader parses the portable synthetic fixture", () => {
  const buf = readFileSync(
    new URL("../../test-fixtures/synthetic/stata-import.synthetic.dta", import.meta.url),
  );
  const table = parseDta(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(table.nObs, 3);
  assert.equal(table.nVar, 3);
  assert.deepEqual(table.headers, ["countyid", "provname", "income"]);
  assert.equal(table.rows[0]?.countyid, 110101);
  assert.equal(table.rows[1]?.provname, "Central Province");
  assert.equal(table.rows[2]?.income, 22.75);
  assert.equal(table.labels.countyid, "Synthetic county code");
});

for (const release of [117, 118, 119]) {
  test(`Stata ${release} data section uses map offsets when a value contains a closing tag`, () => {
    const buf = readFileSync(new URL(`../../test-fixtures/synthetic/stata-tag-in-string-${release}.synthetic.dta`, import.meta.url));
    const table = parseDta(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.equal(table.rows[0]?.note, "</data>");
    assert.equal(table.rows[2]?.x, 3);
  });
}

test("Stata strL text values are decoded instead of discarded", () => {
  const buf = readFileSync(new URL("../../test-fixtures/synthetic/stata-strl.synthetic.dta", import.meta.url));
  const table = parseDta(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal((table.rows[0]?.note as string).length, 2100);
  assert.equal(table.rows[0]?.note, "a".repeat(2100));
  assert.equal(table.rows[1]?.note, "b".repeat(2100));
});

test("Stata rejects missing strL references, truncated headers, and unterminated text", () => {
  const fixture = readFileSync(new URL("../../test-fixtures/synthetic/stata-strl.synthetic.dta", import.meta.url));
  const base = Uint8Array.from(fixture);
  const dataStart = fixture.indexOf(Buffer.from("<data>")) + "<data>".length;

  const badReference = Uint8Array.from(base);
  badReference[dataStart + 6] = 99;
  assert.throws(() => parseDta(badReference.buffer), /引用了不存在的 strL 记录/);

  const badTerminator = Uint8Array.from(base);
  const strlStart = fixture.indexOf(Buffer.from("<strls>")) + "<strls>".length;
  const textLength = new DataView(badTerminator.buffer).getUint32(strlStart + 16, true);
  badTerminator[strlStart + 20 + textLength - 1] = 120;
  assert.throws(() => parseDta(badTerminator.buffer), /缺少结尾 NUL/);

  const shortHeader = Uint8Array.from(base);
  const mapData = fixture.indexOf(Buffer.from("<map>")) + "<map>".length;
  const view = new DataView(shortHeader.buffer);
  const strlsOffset = Number(view.getBigUint64(mapData + 10 * 8, true));
  view.setBigUint64(mapData + 11 * 8, BigInt(strlsOffset + 31), true);
  assert.throws(() => parseDta(shortHeader.buffer), /strL 区固定头部长度不足/);
});

test("Stata keeps large numeric measures numeric", () => {
  const buf = readFileSync(new URL("../../test-fixtures/synthetic/stata-large-measure.synthetic.dta", import.meta.url));
  const table = parseDta(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(table.rows[0]?.large_measure, 9007199254740992);
  assert.equal(typeof table.rows[0]?.large_measure, "number");
});

test("Stata value-label text containing closing tags survives map-based table parsing", () => {
  const buf = readFileSync(new URL("../../test-fixtures/synthetic/stata-value-label-tags.synthetic.dta", import.meta.url));
  const table = parseDta(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(table.lblnames.q, "q");
  assert.equal(table.valueLabels.q?.[1], "contains </lbl> and </value_labels>");
  assert.equal(table.valueLabels.q?.[2], "ordinary");
});

test("Stata fixed-width text retains source leading and trailing spaces", () => {
  const buf = readFileSync(new URL("../../test-fixtures/synthetic/stata-whitespace.synthetic.dta", import.meta.url));
  const table = parseDta(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(table.rows[0]?.note, "  leading and trailing  ");
});

test("Stata rejects legacy non-UTF-8 text instead of replacing bytes", () => {
  const buf = readFileSync(new URL("../../test-fixtures/synthetic/stata-latin1-117.synthetic.dta", import.meta.url));
  assert.throws(() => parseDta(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), /不是有效 UTF-8.*重导出为 Unicode 118\/119/);
});

test("CSV and TSV preserve identifiers, source codes, duplicate columns, and sparse candidates", () => {
  const csv = datasetFromCsv("ids.csv", 'record_id,,score,score,code,note,sparse\n00017,alpha,97,,9007199254740993,"  words ;; and || marks  ",\n00018,beta,99,2,9007199254740994,other note,5\n');
  assert.deepEqual(Object.keys(csv.rows[0] ?? {}), ["record_id", "列2", "score", "score_2", "code", "note", "sparse"]);
  assert.equal(csv.rows[0]?.record_id, "00017");
  assert.equal(csv.rows[0]?.score, 97);
  assert.equal(csv.rows[1]?.score, 99);
  assert.equal(csv.rows[0]?.code, "9007199254740993");
  assert.equal(csv.rows[1]?.code, "9007199254740994");
  assert.equal(csv.rows[0]?.note, "  words ;; and || marks  ");
  assert.equal(csv.rows[0]?.sparse, null);
  assert.equal(csv.rows[1]?.sparse, 5);
  assert.ok(csv.catalog?.some((item) => item.key === "sparse"));
  const tsv = datasetFromCsv("ids.tsv", "subject_id\tmeasure\n00123\t-4\n00124\t5\n");
  assert.equal(tsv.rows[0]?.subject_id, "00123");
  assert.equal(tsv.rows[0]?.measure, -4);
});

test("CSV rejects malformed widths and unclosed quotes with Chinese guidance", () => {
  assert.throws(() => datasetFromCsv("broken.csv", "id,value\n1,2,3\n"), /第 2 行有 3 列/);
  assert.throws(() => datasetFromCsv("broken.csv", 'id,value\n1,"2\n'), /引号未闭合/);
});

test("Stata value labels remain metadata and do not replace numeric values", () => {
  const ds = datasetFromParsed("labels", ["id", "answer"], [{ id: "a", answer: 97 }, { id: "b", answer: 99 }], {
    lblnames: { answer: "answers" },
    valueLabelSets: { answers: { 97: "不适用", 99: "拒答" } },
  });
  assert.equal(ds.rows[0]?.answer, 97);
  assert.equal(ds.rows[1]?.answer, 99);
  assert.equal(ds.valueLabels?.answer?.["97"], "不适用");
});

test("synthetic dta import becomes a dataset", () => {
  const buf = readFileSync(
    new URL("../../test-fixtures/synthetic/stata-import.synthetic.dta", import.meta.url),
  );
  const ds = datasetFromDta(
    "stata-import.synthetic.dta",
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  assert.equal(ds.rows.length, 3);
  assert.ok(ds.entityKey);
  assert.equal(ds.rows[0]?.provname, "North Province");
});

test("synthetic Excel import reads a codebook workbook", async () => {
  const buf = readFileSync(
    new URL("../../test-fixtures/synthetic/excel-codebook.synthetic.xls", import.meta.url),
  );
  const ds = await datasetFromSpreadsheet(
    "excel-codebook.synthetic.xls",
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  assert.equal(ds.rows.length, 3);
  assert.deepEqual(Object.keys(ds.rows[0] ?? {}), ["indicator", "label", "value"]);
  assert.equal(ds.rows[1]?.indicator, "income");
  assert.equal(ds.rows[1]?.label, "Income score");
  assert.equal(ds.rows[1]?.value, 2);
  assert.ok(ds.indicators.length + Object.keys(ds.rows[0] ?? {}).length > 0);
});

test("Excel text identifiers retain leading zeroes and unsafe integer digits", async () => {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["record_id", "measure"],
    ["000123", 1],
    ["9007199254740993", 2],
  ]);
  XLSX.utils.book_append_sheet(wb, sheet, "IDs");
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const ds = await datasetFromSpreadsheet("ids.xlsx", bytes);
  assert.equal(ds.rows[0]?.record_id, "000123");
  assert.equal(ds.rows[1]?.record_id, "9007199254740993");
  assert.equal(ds.rows[1]?.measure, 2);
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
