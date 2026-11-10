// Value rules for the controls on the subgraph input boundary. Classic rows are the
// frontend's own widgets; the Nodes 2.0 controls follow its number input: step2, a tenth
// of a large step, or one unit of precision, and min/max clamping.

const KINDS = {
  number: "number",
  slider: "number",
  combo: "combo",
  toggle: "toggle",
  boolean: "toggle",
  text: "text",
  customtext: "multiline",
  textarea: "multiline",
};

export function controlKind(type) {
  return KINDS[type] ?? "readonly";
}

export function numberStep(options) {
  if (options.step2 !== undefined) return options.step2;
  if (options.step > 10) return options.step / 10;
  if (options.precision !== undefined) return options.precision === 0 ? 1 : Number((10 ** -options.precision).toFixed(options.precision));
  return 0;
}

export function constrainNumber(value, options) {
  let next = value;
  if (options.precision === 0) {
    const step = options.step2 || 1;
    const offset = (options.min ?? 0) % step;
    next = Math.round((next - offset) / step) * step + offset;
  } else if (options.round) {
    next = Math.round(next / options.round) * options.round;
  }
  if (options.min != null && next < options.min) next = options.min;
  if (options.max != null && next > options.max) next = options.max;
  if (options.precision != null) next = Number(next.toFixed(options.precision));
  return next;
}

export function parseNumber(text) {
  if (text.trim() === "") return undefined;
  const value = Number(text.replaceAll(",", ""));
  return Number.isFinite(value) ? value : undefined;
}

const formats = new Map();

export function formatNumber(value, options) {
  if (value == null) return "";
  const digits = options.precision;
  const grouping = options.useGrouping === true;
  const key = `${digits}|${grouping}`;
  if (!formats.has(key)) {
    formats.set(key, new Intl.NumberFormat("en-US", { useGrouping: grouping, minimumFractionDigits: digits, maximumFractionDigits: digits ?? 3 }));
  }
  return formats.get(key).format(value);
}

export function sliderPercent(value, { min, max, step }) {
  if (min === undefined || max === undefined || step === undefined || max <= min || (max - min) / step >= 100) return 0;
  return Math.round(((value - min) / (max - min)) * 100);
}

// Widget classes hit-test against the node's width: the outer 40 units on each side are
// the arrows, and the rest is the value, which a slider reads in proportion. `x` is
// measured on a widget drawn `width` wide.
export function widgetPointerX(x, width, nodeWidth) {
  if (x < 40) return x;
  if (x > width - 40) return nodeWidth - (width - x);
  return 40 + ((x - 40) * (nodeWidth - 80)) / (width - 80);
}

export function isLocked(options) {
  return !!(options?.disabled || options?.read_only);
}

export function comboValues(options, widget, node) {
  const values = typeof options.values === "function" ? options.values(widget, node) : options.values;
  if (Array.isArray(values)) return values;
  return values ? Object.keys(values) : [];
}

export function toggleText(value, options) {
  return value ? options.on || "true" : options.off || "false";
}

export function firstLine(value) {
  return String(value ?? "").split("\n")[0];
}
