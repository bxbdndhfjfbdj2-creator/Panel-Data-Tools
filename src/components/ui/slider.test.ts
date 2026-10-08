import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Slider } from "./slider.tsx";

test("slider accessible name reaches the focusable Radix thumb and preserves root label props", () => {
  const markup = renderToStaticMarkup(
    createElement(Slider, { "aria-label": "维度权重", "aria-labelledby": "weight-label", value: [25] }),
  );
  const root = markup.match(/<span[^>]*data-orientation="horizontal"[^>]*>/)?.[0];
  const thumb = markup.match(/<span[^>]*role="slider"[^>]*>/)?.[0];
  assert.ok(root, `expected Radix slider root in markup: ${markup}`);
  assert.ok(thumb, `expected focusable Radix thumb in markup: ${markup}`);
  assert.match(root, /aria-label="维度权重"/);
  assert.match(root, /aria-labelledby="weight-label"/);
  assert.match(thumb, /aria-label="维度权重"/);
  assert.match(thumb, /aria-labelledby="weight-label"/);
});
