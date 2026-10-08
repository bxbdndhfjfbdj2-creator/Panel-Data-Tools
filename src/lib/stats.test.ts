import assert from "node:assert/strict";
import { test } from "node:test";
import { eigenSym, topsisCloseness } from "./stats.ts";

function densePsd(size: number): number[][] {
  const basis = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => Math.sin((i + 1) * (j + 3) * 0.173) + Math.cos((i + 5) * (j + 1) * 0.097)),
  );
  return Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => {
      let sum = 0;
      for (let k = 0; k < size; k++) sum += basis[k]![i]! * basis[k]![j]!;
      return sum / size;
    }),
  );
}

test("symmetric eigendecomposition converges and reconstructs dense PSD matrices through 80 dimensions", () => {
  for (const n of [12, 24, 60, 80]) {
    const matrix = densePsd(n);
    const { values, vectors } = eigenSym(matrix);
    assert.equal(values.length, n);
    assert.equal(vectors.length, n);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let inner = 0;
        for (let i = 0; i < n; i++) {
          inner += vectors[a]![i]! * vectors[b]![i]!;
        }
        // vectors remain sorted eigenvectors stored as rows.
        assert.ok(Math.abs(inner - (a === b ? 1 : 0)) < 2e-8, `orthogonality ${n}x${n}, ${a}/${b}`);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let rebuilt = 0;
        for (let k = 0; k < n; k++) rebuilt += values[k]! * vectors[k]![i]! * vectors[k]![j]!;
        assert.ok(Math.abs(rebuilt - matrix[i]![j]!) < 2e-8, `reconstruction ${n}x${n}, ${i}/${j}`);
      }
    }
  }
});

test("symmetric eigendecomposition rejects malformed input and reports nonconvergence", () => {
  assert.throws(() => eigenSym([[1, 2], [0, 1]]), /symmetric/);
  assert.throws(() => eigenSym([[1, Number.NaN], [Number.NaN, 1]]), /finite/);
  assert.throws(() => eigenSym([[1, 0], [0]]), /square/);
  assert.throws(() => eigenSym(densePsd(12), 1), /did not converge/);
});

test("TOPSIS handles large row counts without argument spreading", () => {
  const rows = Array.from({ length: 150_000 }, (_, i) => [i / 150_000, i / 150_000]);
  const scores = topsisCloseness(rows);
  assert.equal(scores.length, rows.length);
  assert.ok(scores[0]! < scores[scores.length - 1]!);
  assert.ok(scores.every(Number.isFinite));
});
