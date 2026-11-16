import { test } from "node:test";
import assert from "node:assert/strict";

import { findValueSource } from "../web/js/value_source.js";

function makeGraph() {
  const nodes = [];
  const links = new Map();
  let nextLink = 1;
  const graph = {
    links,
    nodes,
    getNodeById: (id) => nodes.find((n) => n.id === id) ?? null,
    add(node) {
      nodes.push(node);
      return node;
    },
    link(origin, target, inputName) {
      const id = nextLink++;
      links.set(id, { id, origin_id: origin.id, origin_slot: 0 });
      origin.outputs ??= [{ links: [] }];
      origin.outputs[0].links.push(id);
      if (target) target.inputs.find((i) => i.name === inputName).link = id;
      return id;
    },
  };
  return graph;
}

function primitiveInt(graph, id, value) {
  return graph.add({
    id,
    mode: 0,
    type: "PrimitiveInt",
    inputs: [{ name: "value", link: null, widget: { name: "value" } }],
    widgets: [
      { name: "value", value },
      { name: "control_after_generate", value: "fixed" },
    ],
  });
}

test("a primitive linked straight in is the source", () => {
  const graph = makeGraph();
  const int = primitiveInt(graph, 1, 5);

  const source = findValueSource(graph, graph.link(int));

  assert.equal(source.node, int);
  assert.equal(source.widget, int.widgets[0]);
});

test("a chain of primitives leads to the first one", () => {
  const graph = makeGraph();
  const first = primitiveInt(graph, 1, 5);
  const second = primitiveInt(graph, 2, 0);
  graph.link(first, second, "value");

  const source = findValueSource(graph, graph.link(second));

  assert.equal(source.node, first);
});

test("a legacy Reroute node is passed through", () => {
  const graph = makeGraph();
  const int = primitiveInt(graph, 1, 5);
  const reroute = graph.add({ id: 2, mode: 0, type: "Reroute", inputs: [{ name: "", link: null }], widgets: [] });
  graph.link(int, reroute, "");

  const source = findValueSource(graph, graph.link(reroute));

  assert.equal(source.node, int);
});

test("a legacy PrimitiveNode uses its only widget", () => {
  const graph = makeGraph();
  const prim = graph.add({ id: 1, mode: 0, type: "PrimitiveNode", inputs: [], widgets: [{ name: "steps", value: 20 }] });

  const source = findValueSource(graph, graph.link(prim));

  assert.equal(source.widget, prim.widgets[0]);
});

test("a computed output is not a source, and names the node it stopped at", () => {
  const graph = makeGraph();
  const math = graph.add({ id: 1, mode: 0, type: "SimpleMath", inputs: [], widgets: [{ name: "value", value: "a+b" }] });

  const source = findValueSource(graph, graph.link(math));

  assert.equal(source.node, math);
  assert.equal(source.widget, undefined);
});

test("a primitive fed by a computed output is not a source", () => {
  const graph = makeGraph();
  const math = graph.add({ id: 1, mode: 0, type: "SimpleMath", inputs: [], widgets: [] });
  const int = primitiveInt(graph, 2, 0);
  graph.link(math, int, "value");

  const source = findValueSource(graph, graph.link(int));

  assert.equal(source.node, math);
  assert.equal(source.widget, undefined);
});

test("a primitive that feeds only this input is not shared", () => {
  const graph = makeGraph();
  const int = primitiveInt(graph, 1, 5);

  assert.equal(findValueSource(graph, graph.link(int)).shared, false);
});

test("a primitive that also feeds another node is shared", () => {
  const graph = makeGraph();
  const int = primitiveInt(graph, 1, 5);
  graph.link(int);

  assert.equal(findValueSource(graph, graph.link(int)).shared, true);
});

test("a chain whose first primitive also feeds another node is shared", () => {
  const graph = makeGraph();
  const first = primitiveInt(graph, 1, 5);
  const second = primitiveInt(graph, 2, 0);
  graph.link(first, second, "value");
  graph.link(first);

  assert.equal(findValueSource(graph, graph.link(second)).shared, true);
});

test("a reroute that splits the value makes it shared", () => {
  const graph = makeGraph();
  const int = primitiveInt(graph, 1, 5);
  const reroute = graph.add({ id: 2, mode: 0, type: "Reroute", inputs: [{ name: "", link: null }], widgets: [] });
  graph.link(int, reroute, "");
  graph.link(reroute);

  assert.equal(findValueSource(graph, graph.link(reroute)).shared, true);
});

test("a link from the enclosing subgraph's input boundary is not followed", () => {
  const graph = makeGraph();
  const id = 99;
  graph.links.set(id, { id, origin_id: -10, origin_slot: 0 });

  assert.equal(findValueSource(graph, id), null);
});

test("a muted primitive is not a source, and names itself", () => {
  const graph = makeGraph();
  const int = primitiveInt(graph, 1, 5);
  int.mode = 2;

  const source = findValueSource(graph, graph.link(int));

  assert.equal(source.node, int);
  assert.equal(source.widget, undefined);
});

test("a loop of primitives stops instead of running forever", () => {
  const graph = makeGraph();
  const a = primitiveInt(graph, 1, 0);
  const b = primitiveInt(graph, 2, 0);
  graph.link(a, b, "value");
  graph.link(b, a, "value");

  assert.strictEqual(findValueSource(graph, graph.link(b)), null);
});

test("a muted or bypassed node in the chain is not a source", () => {
  for (const mode of [2, 4]) {
    const graph = makeGraph();
    const first = primitiveInt(graph, 1, 5);
    const second = primitiveInt(graph, 2, 0);
    graph.link(first, second, "value");
    first.mode = mode;

    assert.equal(findValueSource(graph, graph.link(second)).widget, undefined);
  }
});

test("a muted node in the middle of a chain stops it without a shared mark", () => {
  const graph = makeGraph();
  const first = primitiveInt(graph, 1, 5);
  const second = primitiveInt(graph, 2, 0);
  graph.link(first, second, "value");
  graph.link(second);
  second.mode = 2;

  const source = findValueSource(graph, graph.link(second));

  assert.deepEqual(source, { node: second });
});
