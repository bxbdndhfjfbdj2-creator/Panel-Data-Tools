import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assocMatrix,
  kendallTauB,
  kendallW,
  kruskalWallis,
  loevingerH,
  mad,
  mannKendall,
  mannKendallSen,
  mannWhitney,
  median,
  pearsonSpearmanGap,
  robustCv,
  senSlope,
  trimmedMean,
} from "./npar.ts";

test("median and trimmed mean", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  const t = trimmedMean([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 0.1);
  assert.ok(t < 20);
});

test("MAD is robust to an outlier", () => {
  const xs = [10, 11, 12, 10, 11, 12, 10, 11, 200];
  assert.ok(mad(xs) < 5);
  assert.ok(robustCv(xs) < 0.5);
});

test("Kendall tau is 1 on a monotone pair", () => {
  const x = [1, 2, 3, 4, 5, 6];
  const y = [2, 4, 6, 8, 10, 12];
  assert.ok(Math.abs(kendallTauB(x, y) - 1) < 1e-9);
  assert.ok(kendallTauB(x, [...x].reverse()) < -0.99);
});

test("assocMatrix spearman matches ranks", () => {
  const cols = [
    [1, 2, 3, 4, 5, 6, 7, 8],
    [1, 4, 9, 16, 25, 36, 49, 64],
  ];
  const R = assocMatrix(cols, "spearman");
  assert.ok(R[0]![1]! > 0.99);
});

test("nonlinear gap flags a hockey-stick", () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 20];
  const b = [1, 2, 3, 4, 5, 6, 7, 8, 9, 80];
  assert.ok(pearsonSpearmanGap(a, b) > 0.02);
});

test("Mokken H is high on a Guttman-like scale", () => {
  const items = [
    [1, 2, 3, 3, 4, 4, 5, 5],
    [1, 2, 2, 3, 4, 4, 5, 5],
    [1, 1, 2, 3, 3, 4, 4, 5],
  ];
  const { H, itemH } = loevingerH(items);
  assert.ok(H > 0.4, String(H));
  assert.equal(itemH.length, 3);
});

test("Mann-Kendall detects an increasing series", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const mk = mannKendall(xs);
  assert.ok(mk.S > 0);
  assert.ok(mk.p < 0.01);
  assert.ok(mk.tau > 0.9);
  const sen = senSlope(xs, [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]);
  assert.ok(Math.abs(sen.slope - 1) < 1e-9);
});

test("Mann-Kendall is null on noise around a constant", () => {
  const xs = [5, 5, 5, 5, 5, 5, 5, 5];
  const mk = mannKendall(xs);
  assert.equal(mk.S, 0);
});

test("Sen slope on a known line", () => {
  const r = mannKendallSen([10, 12, 14, 16, 18, 20], [0, 1, 2, 3, 4, 5]);
  assert.equal(r.slope, 2);
  assert.ok(r.p < 0.05);
});

test("Kendall W is 1 when ranks agree", () => {
  const ranks = [
    [1, 2, 3, 4],
    [1, 2, 3, 4],
    [1, 2, 3, 4],
  ];
  const w = kendallW(ranks);
  assert.ok(Math.abs(w.W - 1) < 1e-9);
});

test("Kruskal-Wallis separates shifted groups", () => {
  const kw = kruskalWallis([
    [1, 2, 3, 2, 1, 3],
    [8, 9, 10, 9, 8, 10],
    [20, 21, 22, 21, 20, 19],
  ]);
  assert.ok(kw.H > 5, String(kw.H));
  assert.ok(kw.p < 0.05, String(kw.p));
});

test("Mann-Whitney two-sample", () => {
  const mw = mannWhitney([1, 2, 3, 2, 1], [8, 9, 10, 9, 8]);
  assert.ok(mw.p < 0.05);
  assert.ok(mw.U < mw.n1 * mw.n2);
});
