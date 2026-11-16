import { test } from "node:test";
import assert from "node:assert/strict";

import { moveInput, moveOutput } from "../web/js/slot_order.mjs";

const SG = "sg-1";

// A workflow with one subgraph (inputs a, b, c; b and c carry widgets) used by two
// instances in the root graph and one inside another subgraph.
function workflow() {
  const instance = (id, values, links) => ({
    id,
    type: SG,
    inputs: [
      { name: "a", link: links[0] },
      { name: "b", link: links[1], widget: { name: "b" } },
      { name: "c", link: links[2], widget: { name: "c" } },
    ],
    widgets_values: values,
  });
  return {
    nodes: [instance(1, [10, "x"], [100, null, null]), instance(2, [20, "y"], [null, 101, null]), { id: 3, type: "PrimitiveInt", inputs: [] }],
    links: [
      [100, 9, 0, 1, 0, "MODEL"],
      [101, 3, 0, 2, 1, "INT"],
      [102, 3, 0, 4, 0, "INT"],
    ],
    // Left on input c of instance 1 by a reroute whose source was removed.
    floatingLinks: [{ id: 300, origin_id: -1, origin_slot: -1, target_id: 1, target_slot: 2, parentId: 1 }],
    definitions: {
      subgraphs: [
        {
          id: SG,
          inputs: [
            { id: "in-a", name: "a" },
            { id: "in-b", name: "b" },
            { id: "in-c", name: "c" },
          ],
          nodes: [{ id: 50, type: "KSampler" }],
          links: [
            { id: 1, origin_id: -10, origin_slot: 0, target_id: 50, target_slot: 0 },
            { id: 2, origin_id: -10, origin_slot: 1, target_id: 50, target_slot: 4 },
            { id: 3, origin_id: -10, origin_slot: 2, target_id: 50, target_slot: 5 },
            { id: 4, origin_id: 50, origin_slot: 0, target_id: -20, target_slot: 0 },
          ],
          floatingLinks: [{ id: 5, origin_id: -10, origin_slot: 2, target_id: -1, target_slot: -1 }],
        },
        {
          id: "outer",
          inputs: [],
          nodes: [instance(7, [30, "z"], [null, null, 200])],
          links: [{ id: 200, origin_id: 8, origin_slot: 0, target_id: 7, target_slot: 2 }],
        },
      ],
    },
  };
}

const def = (data) => data.definitions.subgraphs[0];
const names = (inputs) => inputs.map((i) => i.name);

test("moves the input in the subgraph and in every instance", () => {
  const data = workflow();

  assert.equal(moveInput(data, SG, 2, 0), true);

  assert.deepEqual(names(def(data).inputs), ["c", "a", "b"]);
  assert.deepEqual(names(data.nodes[0].inputs), ["c", "a", "b"]);
  assert.deepEqual(names(data.nodes[1].inputs), ["c", "a", "b"]);
  assert.deepEqual(names(data.definitions.subgraphs[1].nodes[0].inputs), ["c", "a", "b"]);
});

test("each instance keeps its own values, reordered with the widgets", () => {
  const data = workflow();

  moveInput(data, SG, 2, 0);

  assert.deepEqual(data.nodes[0].widgets_values, ["x", 10]);
  assert.deepEqual(data.nodes[1].widgets_values, ["y", 20]);
  assert.deepEqual(data.definitions.subgraphs[1].nodes[0].widgets_values, ["z", 30]);
});

test("links into the instances follow their inputs", () => {
  const data = workflow();

  moveInput(data, SG, 0, 2);

  assert.deepEqual(names(def(data).inputs), ["b", "c", "a"]);
  assert.equal(data.links[0][4], 2, "root link 100 still reaches input a");
  assert.equal(data.links[1][4], 0, "root link 101 still reaches input b");
  assert.equal(data.links[2][4], 0, "a link to another node is untouched");
  assert.equal(data.definitions.subgraphs[1].links[0].target_slot, 1, "link 200 in another subgraph still reaches input c");
});

test("links leaving the input boundary inside follow their inputs", () => {
  const data = workflow();

  moveInput(data, SG, 2, 0);

  const slots = Object.fromEntries(def(data).links.map((l) => [l.id, l.origin_slot]));
  assert.deepEqual(slots, { 1: 1, 2: 2, 3: 0, 4: 0 });
  assert.equal(def(data).floatingLinks[0].origin_slot, 0);
});

test("moving an input onto its own place changes nothing", () => {
  const data = workflow();
  const before = structuredClone(data);

  assert.equal(moveInput(data, SG, 1, 1), false);
  assert.deepEqual(data, before);
});

test("an instance whose saved values do not match its widget inputs leaves the workflow untouched", () => {
  const data = workflow();
  data.nodes[1].widgets_values = [20];
  const before = structuredClone(data);

  assert.equal(moveInput(data, SG, 2, 0), false);
  assert.deepEqual(data, before);
});

test("a floating link left on an instance's input follows it", () => {
  const data = workflow();

  moveInput(data, SG, 2, 0);

  assert.equal(data.floatingLinks[0].target_slot, 0);
});

test("an instance saved without widget values still moves", () => {
  const data = workflow();
  delete data.nodes[1].widgets_values;

  assert.equal(moveInput(data, SG, 2, 0), true);

  assert.deepEqual(names(data.nodes[1].inputs), ["c", "a", "b"]);
  assert.equal(data.nodes[1].widgets_values, undefined);
});

test("moving one place down swaps two neighbors", () => {
  const data = workflow();

  moveInput(data, SG, 0, 1);

  assert.deepEqual(names(def(data).inputs), ["b", "a", "c"]);
  assert.equal(data.links[0][4], 1);
  assert.equal(data.links[1][4], 0);
});

test("a node with the same id in another graph keeps its links", () => {
  const data = workflow();
  // Node 7 is an instance inside "outer"; the root's node 7 is something else.
  data.nodes.push({ id: 7, type: "KSampler", inputs: [] });
  data.links.push([400, 3, 0, 7, 2, "INT"]);

  moveInput(data, SG, 2, 0);

  assert.equal(data.links.at(-1)[4], 2);
  assert.equal(data.definitions.subgraphs[1].links[0].target_slot, 0);
});

// One subgraph with outputs x, y, z: x and z feed links outside, y feeds two nodes.
function outputsWorkflow() {
  const instance = (id) => ({ id, type: SG, inputs: [], outputs: [{ name: "x", links: [500] }, { name: "y", links: [501, 502] }, { name: "z", links: [503] }] });
  return {
    nodes: [instance(1), { id: 2, type: "PreviewImage", inputs: [] }],
    links: [
      [500, 1, 0, 2, 0, "IMAGE"],
      [501, 1, 1, 2, 1, "LATENT"],
      [502, 1, 1, 3, 0, "LATENT"],
      [503, 1, 2, 3, 1, "MASK"],
      [504, 2, 0, 1, 0, "IMAGE"],
    ],
    floatingLinks: [{ id: 600, origin_id: 1, origin_slot: 2, target_id: -1, target_slot: -1, parentId: 4 }],
    definitions: {
      subgraphs: [
        {
          id: SG,
          inputs: [],
          outputs: [{ name: "x" }, { name: "y" }, { name: "z" }],
          nodes: [{ id: 50, type: "VAEDecode" }],
          links: [
            { id: 10, origin_id: 50, origin_slot: 0, target_id: -20, target_slot: 0 },
            { id: 11, origin_id: 50, origin_slot: 1, target_id: -20, target_slot: 1 },
            { id: 12, origin_id: 50, origin_slot: 2, target_id: -20, target_slot: 2 },
            { id: 13, origin_id: -10, origin_slot: 0, target_id: 50, target_slot: 2 },
          ],
        },
        { id: "outer", inputs: [], outputs: [], nodes: [instance(7)], links: [{ id: 700, origin_id: 7, origin_slot: 2, target_id: 8, target_slot: 0 }] },
      ],
    },
  };
}

test("moves an output in the subgraph and in every instance", () => {
  const data = outputsWorkflow();

  assert.equal(moveOutput(data, SG, 2, 0), true);

  assert.deepEqual(names(def(data).outputs), ["z", "x", "y"]);
  assert.deepEqual(names(data.nodes[0].outputs), ["z", "x", "y"]);
  assert.deepEqual(data.nodes[0].outputs[2].links, [501, 502], "an output keeps its own links");
  assert.deepEqual(names(data.definitions.subgraphs[1].nodes[0].outputs), ["z", "x", "y"]);
});

test("links into the output boundary and out of the instances follow their outputs", () => {
  const data = outputsWorkflow();

  moveOutput(data, SG, 2, 0);

  assert.deepEqual(def(data).links.map((l) => l.target_slot), [1, 2, 0, 2], "the link to an inner node is untouched");
  assert.deepEqual(data.links.map((l) => l[2]), [1, 2, 2, 0, 0], "link 504 starts at another node and is untouched");
  assert.equal(data.floatingLinks[0].origin_slot, 0);
  assert.equal(data.definitions.subgraphs[1].links[0].origin_slot, 0);
});

test("moving an output onto its own place changes nothing", () => {
  const data = outputsWorkflow();
  const before = structuredClone(data);

  assert.equal(moveOutput(data, SG, 1, 1), false);
  assert.deepEqual(data, before);
});

test("moving an output down keeps every link with its output, in every instance", () => {
  const data = outputsWorkflow();
  const second = structuredClone(data.nodes[0]);
  second.id = 5;
  data.nodes.push(second);
  data.links.push([505, 5, 2, 2, 2, "MASK"]);

  moveOutput(data, SG, 0, 2);

  assert.deepEqual(names(data.nodes[0].outputs), ["y", "z", "x"]);
  assert.deepEqual(names(data.nodes[2].outputs), ["y", "z", "x"]);
  assert.deepEqual(data.links.map((l) => l[2]), [2, 0, 0, 1, 0, 1]);
});

test("an instance inside another subgraph moves its links to that subgraph's output boundary by origin only", () => {
  const data = outputsWorkflow();
  data.definitions.subgraphs[1].links.push({ id: 701, origin_id: 7, origin_slot: 0, target_id: -20, target_slot: 0 });

  moveOutput(data, SG, 0, 2);

  const link = data.definitions.subgraphs[1].links.at(-1);
  assert.deepEqual([link.origin_slot, link.target_slot], [2, 0]);
});
