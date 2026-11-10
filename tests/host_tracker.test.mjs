import { test } from "node:test";
import assert from "node:assert/strict";

import { createHostTracker, resolveHost } from "../web/js/host_tracker.mjs";

function makeGraph(id, nodes = []) {
  const graph = { id, nodes, getNodeById: (nodeId) => graph.nodes.find((n) => n.id === nodeId) ?? null };
  return graph;
}

function makeHost(id, graph, subgraph) {
  const host = { id, graph, subgraph, isSubgraphNode: () => true };
  graph.nodes.push(host);
  return host;
}

function makeWorld() {
  const root = makeGraph("root");
  root.rootGraph = root;
  const sg = makeGraph("sg-1");
  const inner = makeGraph("sg-2");
  root.subgraphs = new Map([[sg.id, sg], [inner.id, inner]]);
  sg.rootGraph = root;
  inner.rootGraph = root;
  return { root, sg, inner };
}

test("records the host passed by subgraph-opened", () => {
  const { root, sg } = makeWorld();
  const a = makeHost(1, root, sg);
  makeHost(2, root, sg);
  const tracker = createHostTracker();

  tracker.graphChanged(sg, false);
  tracker.opened(sg, a);

  assert.equal(resolveHost(tracker.top(), sg), a);
});

test("entering without fromNode does not reuse an earlier instance", () => {
  const { root, sg } = makeWorld();
  const a = makeHost(1, root, sg);
  makeHost(2, root, sg);
  const tracker = createHostTracker();

  tracker.graphChanged(sg, false);
  tracker.opened(sg, a);
  tracker.graphChanged(root, true);
  tracker.graphChanged(sg, false);

  assert.equal(resolveHost(tracker.top(), sg), null);
});

test("falls back to the only instance when nothing was recorded", () => {
  const { root, sg } = makeWorld();
  const only = makeHost(1, root, sg);
  const tracker = createHostTracker();

  tracker.graphChanged(sg, false);

  assert.equal(resolveHost(tracker.top(), sg), only);
});

test("finds the only instance inside another subgraph", () => {
  const { sg, inner } = makeWorld();
  const only = makeHost(7, sg, inner);
  const tracker = createHostTracker();

  tracker.graphChanged(inner, false);

  assert.equal(resolveHost(tracker.top(), inner), only);
});

test("keeps the outer host when moving back up from a nested subgraph", () => {
  const { root, sg, inner } = makeWorld();
  const a = makeHost(1, root, sg);
  makeHost(2, root, sg);
  const nested = makeHost(9, sg, inner);
  const tracker = createHostTracker();

  tracker.graphChanged(sg, false);
  tracker.opened(sg, a);
  tracker.graphChanged(inner, false);
  tracker.opened(inner, nested);
  tracker.graphChanged(sg, false);

  assert.equal(resolveHost(tracker.top(), sg), a);
});

test("keeps the host when the same subgraph is loaded again, as undo does", () => {
  const { root, sg } = makeWorld();
  const a = makeHost(1, root, sg);
  makeHost(2, root, sg);
  const tracker = createHostTracker();

  tracker.graphChanged(sg, false);
  tracker.opened(sg, a);
  const reloaded = makeGraph("sg-1");
  reloaded.rootGraph = root;
  root.subgraphs.set(reloaded.id, reloaded);
  a.subgraph = reloaded;
  tracker.graphChanged(reloaded, false);

  assert.equal(resolveHost(tracker.top(), reloaded), a);
});

test("a recorded host that was deleted or now opens another subgraph is not used", () => {
  for (const change of ["delete", "repoint"]) {
    const { root, sg, inner } = makeWorld();
    const a = makeHost(1, root, sg);
    makeHost(2, root, sg);
    makeHost(3, root, sg);
    const tracker = createHostTracker();

    tracker.graphChanged(sg, false);
    tracker.opened(sg, a);
    if (change === "delete") root.nodes.splice(root.nodes.indexOf(a), 1);
    else a.subgraph = inner;

    assert.equal(resolveHost(tracker.top(), sg), null, change);
  }
});

test("subgraph-opened for a graph that is not on top records nothing", () => {
  const { root, sg, inner } = makeWorld();
  makeHost(1, root, sg);
  const b = makeHost(2, root, sg);
  const tracker = createHostTracker();

  tracker.graphChanged(sg, false);
  tracker.opened(inner, b);

  assert.equal(resolveHost(tracker.top(), sg), null);
});

test("returns null at the root graph", () => {
  const { root } = makeWorld();
  const tracker = createHostTracker();

  tracker.graphChanged(root, true);

  assert.equal(tracker.top(), null);
});
