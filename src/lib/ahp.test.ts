import assert from "node:assert/strict";
import { test } from "node:test";
import { ahpSaatyToSliderStep, ahpSliderStepToSaaty, identityMatrix, setPair, solveAhp } from "./ahp.ts";

test("AHP slider puts 9:1 left preference at the left endpoint", () => {
  assert.equal(ahpSliderStepToSaaty(-8), 9);
  assert.equal(ahpSliderStepToSaaty(0), 1);
  assert.ok(Math.abs(ahpSliderStepToSaaty(8) - 1 / 9) < 1e-12);
  assert.equal(ahpSaatyToSliderStep(9), -8);
  assert.equal(ahpSaatyToSliderStep(1), 0);
  assert.equal(ahpSaatyToSliderStep(1 / 9), 8);
});

test("AHP solves consistent two and three criterion matrices", () => {
  const two = setPair(identityMatrix(2), 0, 1, 9);
  const result2 = solveAhp(two);
  assert.ok(Math.abs(result2.weights[0]! - 0.9) < 1e-12);
  assert.ok(Math.abs(result2.weights[1]! - 0.1) < 1e-12);
  assert.ok(Math.abs(result2.cr) < 1e-12);

  const three = identityMatrix(3);
  setPair(three, 0, 1, 3);
  const matrix3 = setPair(setPair(three, 0, 1, 3), 1, 2, 2);
  matrix3[0]![2] = 6;
  matrix3[2]![0] = 1 / 6;
  const result3 = solveAhp(matrix3);
  assert.ok(Math.abs(result3.weights[0]! - 6 / 9) < 1e-12);
  assert.ok(Math.abs(result3.weights[1]! - 2 / 9) < 1e-12);
  assert.ok(Math.abs(result3.weights[2]! - 1 / 9) < 1e-12);
  assert.ok(Math.abs(result3.cr) < 1e-12);
});

test("AHP rejects non-positive and non-reciprocal matrices", () => {
  assert.throws(() => solveAhp([[1, 0], [0, 1]]), /finite and positive/);
  assert.throws(() => solveAhp([[1, 2], [1, 1]]), /reciprocal/);
});
