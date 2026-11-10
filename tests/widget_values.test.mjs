import { test } from "node:test";
import assert from "node:assert/strict";

import {
  comboValues,
  constrainNumber,
  controlKind,
  firstLine,
  formatNumber,
  isLocked,
  numberStep,
  parseNumber,
  sliderPercent,
  toggleText,
  widgetPointerX,
} from "../web/js/widget_values.mjs";

test("controlKind shares controls between aliases and falls back to read-only", () => {
  assert.equal(controlKind("slider"), "number");
  assert.equal(controlKind("customtext"), "multiline");
  assert.equal(controlKind("image_upload_preview"), "readonly");
});

test("numberStep follows the Nodes 2.0 number input: step2, a tenth of a large step, or precision", () => {
  assert.equal(numberStep({ step2: 0.05, step: 10 }), 0.05);
  assert.equal(numberStep({ step: 640 }), 64);
  assert.equal(numberStep({ step: 10, precision: 0 }), 1);
  assert.equal(numberStep({ precision: 2 }), 0.01);
  assert.equal(numberStep({}), 0);
});

test("constrainNumber clamps to min and max", () => {
  assert.equal(constrainNumber(-5, { min: 0, max: 10 }), 0);
  assert.equal(constrainNumber(15, { min: 0, max: 10 }), 10);
});

test("constrainNumber rounds integers to step2 offset by min, like the frontend INT widget", () => {
  assert.equal(constrainNumber(2.6, { precision: 0 }), 3);
  assert.equal(constrainNumber(13, { precision: 0, step2: 8 }), 16);
  assert.equal(constrainNumber(13, { precision: 0, step2: 8, min: 2 }), 10);
  assert.equal(constrainNumber(100, { precision: 0, step2: 8, min: 16, max: 64 }), 64);
});

test("constrainNumber snaps floats to round", () => {
  assert.equal(constrainNumber(0.1 + 0.2, { round: 0.01, precision: 2 }), 0.3);
});

test("parseNumber accepts plain or grouped numbers and rejects anything else", () => {
  assert.equal(parseNumber(" 1.5 "), 1.5);
  assert.equal(parseNumber("12,345"), 12345);
  assert.equal(parseNumber("-2"), -2);
  assert.equal(parseNumber(""), undefined);
  assert.equal(parseNumber("abc"), undefined);
  assert.equal(parseNumber("Infinity"), undefined);
});

test("formatNumber fixes the digits to precision, else shows up to three, and leaves a missing value empty", () => {
  assert.equal(formatNumber(1, { precision: 2 }), "1.00");
  assert.equal(formatNumber(1, {}), "1");
  assert.equal(formatNumber(0.12345, {}), "0.123");
  assert.equal(formatNumber(12345, {}), "12345");
  assert.equal(formatNumber(12345, { useGrouping: true }), "12,345");
  assert.equal(formatNumber(undefined, {}), "");
});

test("sliderPercent fills a bounded number with fewer than 100 steps, like the Nodes 2.0 number input", () => {
  assert.equal(sliderPercent(0.5, { min: 0, max: 1, step: 0.1 }), 50);
  assert.equal(sliderPercent(20, { min: 1, max: 10000, step: 10 }), 0);
  assert.equal(sliderPercent(5, { min: 0, step: 1 }), 0);
  assert.equal(sliderPercent(3, { min: 3, max: 3, step: 1 }), 0);
});

test("widgetPointerX moves a press on the drawn widget into the node-wide widget the class expects", () => {
  // Arrows are the outer 40 units on each side and keep their size; the middle is stretched,
  // so a position along a slider stays in proportion.
  assert.equal(widgetPointerX(20, 180, 400), 20);
  assert.equal(widgetPointerX(170, 180, 400), 390);
  assert.equal(widgetPointerX(90, 180, 400), 200);
  assert.equal(widgetPointerX(60, 180, 400), 104);
});

test("comboValues reads an array, the keys of a map, or calls a values function", () => {
  const widget = { options: {} };
  const node = {};
  assert.deepEqual(comboValues({ values: ["a", "b"] }, widget, node), ["a", "b"]);
  assert.deepEqual(comboValues({ values: { low: 1, high: 2 } }, widget, node), ["low", "high"]);
  assert.deepEqual(comboValues({ values: (w, n) => [w === widget, n === node] }, widget, node), [true, true]);
  assert.deepEqual(comboValues({}, widget, node), []);
});

test("firstLine previews multiline text", () => {
  assert.equal(firstLine("first line\nsecond"), "first line");
  assert.equal(firstLine(undefined), "");
});

test("toggleText uses the widget's on and off labels when set", () => {
  assert.equal(toggleText(true, { on: "enabled" }), "enabled");
  assert.equal(toggleText(false, { off: "" }), "false");
});

test("isLocked follows the disabled and read_only options", () => {
  assert.equal(isLocked({}), false);
  assert.equal(isLocked({ disabled: true }), true);
  assert.equal(isLocked({ read_only: true }), true);
  assert.equal(isLocked(undefined), false);
});
