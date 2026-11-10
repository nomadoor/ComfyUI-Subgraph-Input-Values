import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRows } from "../web/js/boundary_rows.mjs";

function makeSubgraph(names) {
  return { inputs: names.map((name, i) => ({ id: `slot-${i}`, name })) };
}

function makeHost(subgraph, specs) {
  const widgets = [];
  const inputs = subgraph.inputs.map((slot, i) => {
    const spec = specs[i] ?? {};
    const input = { name: slot.name, _subgraphSlot: slot, link: spec.linked ? 42 : null };
    if (spec.widget) {
      input.widgetId = `w-${i}`;
      input.widget = { name: slot.name };
      widgets.push({ name: slot.name, type: spec.widget, value: 0 });
    }
    return input;
  });
  const graph = { links: new Map(), nodes: [] };
  graph.getNodeById = (id) => graph.nodes.find((n) => n.id === id) ?? null;
  // Same lookup as LGraphNode.getWidgetFromSlot: by the slot's widget name.
  const getWidgetFromSlot = (input) => widgets.find((w) => w.name === input.widget?.name);
  return { inputs, widgets, graph, getWidgetFromSlot };
}

// Feeds the host's linked input (link 42) from `node` in the parent graph.
function feed(host, node) {
  host.graph.links.set(42, { id: 42, origin_id: node.id, origin_slot: 0 });
  host.graph.nodes.push(node);
}

test("a promoted widget that is not linked outside becomes an editable row", () => {
  const subgraph = makeSubgraph(["steps"]);
  const host = makeHost(subgraph, [{ widget: "number" }]);

  const [row] = buildRows(host, subgraph);

  assert.equal(row.kind, "value");
  assert.equal(row.slot, subgraph.inputs[0]);
  assert.equal(row.widget, host.widgets[0]);
});

test("a promoted widget linked outside to something computed is a read-only linked row", () => {
  const subgraph = makeSubgraph(["steps"]);
  const host = makeHost(subgraph, [{ widget: "number", linked: true }]);
  feed(host, { id: 5, mode: 0, type: "SimpleMath", inputs: [], widgets: [] });

  const [row] = buildRows(host, subgraph);

  assert.equal(row.kind, "linked");
});

test("a promoted widget fed by a primitive outside edits that primitive", () => {
  const subgraph = makeSubgraph(["steps"]);
  const host = makeHost(subgraph, [{ widget: "number", linked: true }]);
  const int = {
    id: 5,
    mode: 0,
    type: "PrimitiveInt",
    inputs: [{ name: "value", link: null, widget: { name: "value" } }],
    widgets: [{ name: "value", type: "number", value: 7 }],
  };
  feed(host, int);

  const [row] = buildRows(host, subgraph);

  assert.equal(row.kind, "source");
  assert.equal(row.widget, int.widgets[0]);
  assert.equal(row.source, int);
});

test("a promoted multiline text, which is a DOM widget without a widgetId, gets a row", () => {
  const subgraph = makeSubgraph(["text"]);
  const host = makeHost(subgraph, [{ widget: "customtext" }]);

  const [row] = buildRows(host, subgraph);

  assert.equal(row.kind, "value");
  assert.equal(row.widget, host.widgets[0]);
});

test("an input without a widget gets no row", () => {
  const subgraph = makeSubgraph(["image"]);
  const host = makeHost(subgraph, [{}]);

  assert.deepEqual(buildRows(host, subgraph), []);
});

test("rows follow the boundary slot order, not the host input order", () => {
  const subgraph = makeSubgraph(["seed", "cfg"]);
  const host = makeHost(subgraph, [{ widget: "number" }, { widget: "number" }]);
  host.inputs.reverse();

  const rows = buildRows(host, subgraph);

  assert.deepEqual(rows.map((row) => row.slot.name), ["seed", "cfg"]);
  assert.deepEqual(rows.map((row) => row.widget.name), ["seed", "cfg"]);
});

test("host inputs are matched by slot id when the slot object was replaced", () => {
  const subgraph = makeSubgraph(["cfg"]);
  const host = makeHost(subgraph, [{ widget: "number" }]);
  host.inputs[0]._subgraphSlot = { id: "slot-0", name: "cfg" };

  const [row] = buildRows(host, subgraph);

  assert.equal(row.widget, host.widgets[0]);
});
