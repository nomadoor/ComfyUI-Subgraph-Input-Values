import { test } from "node:test";
import assert from "node:assert/strict";

import { installBoundaryPatch, rowGeometry } from "../web/js/boundary_patch.mjs";

function rect(x, y, w, h) {
  const r = [x, y, w, h];
  r.containsXy = (px, py) => px >= x && px <= x + w && py >= y && py <= y + h;
  return r;
}

// Minimal stand-ins for SubgraphInput and SubgraphInputNode with the same hit-testing shape.
class FakeSlotBase {
  constructor(parent, dotX, y, labelWidth) {
    this.parent = parent;
    this.pos = [dotX, y];
    this.labelWidth = labelWidth;
    this.boundingRect = rect(dotX - 10 - labelWidth, y - 10, labelWidth + 20, 20);
    this.isPointerOver = false;
  }
  measure() {
    return [this.labelWidth + 20, 20];
  }
  asSerialisable() {
    return { name: "x", pos: this.pos };
  }
}
class FakeSlot extends FakeSlotBase {
  get labelPos() {
    return [this.boundingRect[0], this.pos[1]];
  }
}
class FakeNode {
  static minWidth = 100;
  static roundedRadius = 14;
  constructor() {
    this.slots = [new FakeSlot(this, 500, 100, 40), new FakeSlot(this, 500, 120, 80)];
    this.boundingRect = rect(400, 80, 120, 60);
    this.isPointerOver = false;
    this.downs = [];
    this.nodesHere = [];
    this.subgraph = { getNodeOnPos: (x, y) => this.nodesHere.find((r) => r.containsXy(x, y)) ?? null };
  }
  get size() {
    return this.boundingRect.slice(2);
  }
  get allSlots() {
    return this.slots;
  }
  // Same as SubgraphIONodeBase.arrange: slots hang from the right edge the previous
  // arrange left, then the boundary is sized from them.
  arrange() {
    const [x, y, width] = this.boundingRect;
    const right = x + width - FakeNode.roundedRadius;
    let top = y + FakeNode.roundedRadius;
    let widest = FakeNode.minWidth;
    for (const slot of this.slots) {
      const [w, h] = slot.measure();
      slot.pos = [right - h / 2, top + h / 2];
      top += h;
      widest = Math.max(widest, w);
    }
    this.boundingRect[2] = widest + 2 * FakeNode.roundedRadius;
    this.boundingRect[3] = top - y + FakeNode.roundedRadius;
  }
  asSerialisable() {
    return { id: -10, bounding: [...this.boundingRect] };
  }
  save() {
    return { node: this.asSerialisable(), slots: this.slots.map((slot) => slot.asSerialisable()) };
  }
  containsPoint([x, y]) {
    return this.boundingRect.containsXy(x, y);
  }
  getSlotInPosition(x, y) {
    return this.slots.find((s) => s.boundingRect.containsXy(x, y));
  }
  onPointerEnter() {
    this.isPointerOver = true;
  }
  onPointerMove(e) {
    return this.boundingRect.containsXy(e.canvasX, e.canvasY) ? 64 : 0;
  }
  onPointerDown(e) {
    this.downs.push([e.canvasX, e.canvasY]);
  }
  draw(ctx) {
    ctx.calls.push("boundary");
  }
}

function setup() {
  const shifted = new WeakMap();
  const node = new FakeNode();
  const state = { ignoreRows: false, controlAt: null, presses: [] };
  installBoundaryPatch(node.slots[0], node, shifted, {
    ignoreRows: () => state.ignoreRows,
    bandColors: () => ["#111", "#eee"],
    drawControls: (ctx) => ctx.calls.push("controls"),
    pressControl: (n, e, pointer) => {
      if (e.canvasX !== state.controlAt) return false;
      state.presses.push(pointer);
      return true;
    },
  });
  return { node, shifted, state };
}

test("rowGeometry lays out label, input and band from the slot dot and the label width", () => {
  const g = rowGeometry({ pos: [500, 100] }, 90);
  assert.deepEqual(g, { y: 100, bandLeft: 242, bandRight: 491, labelLeft: 248, inputLeft: 338, inputRight: 488 });
  assert.equal(rowGeometry({ pos: [500, 100] }, 50).labelLeft, 288);
});

test("labels are drawn left-aligned only while the node is shifted", () => {
  const { node, shifted } = setup();
  const slot = node.slots[0];
  assert.deepEqual(slot.labelPos, [450, 100]);
  shifted.set(node, 90);
  assert.deepEqual(slot.labelPos, [248, 100]);
});

test("the whole row band hits its slot while shifted", () => {
  const { node, shifted } = setup();
  assert.equal(node.getSlotInPosition(300, 120), undefined);
  assert.equal(node.containsPoint([300, 120]), false);
  shifted.set(node, 90);
  assert.equal(node.getSlotInPosition(300, 120), node.slots[1]);
  assert.equal(node.containsPoint([300, 120]), true);
  assert.equal(node.getSlotInPosition(300, 150), undefined);
});

test("pressing a row band acts as pressing its slot", () => {
  const { node, shifted } = setup();
  shifted.set(node, 90);
  const e = { button: 0, canvasX: 300, canvasY: 101 };
  node.onPointerDown(e);
  assert.deepEqual(node.downs, [[500, 100]]);
  assert.deepEqual([e.canvasX, e.canvasY], [300, 101]);
});

test("hovering a row band highlights its slot", () => {
  const { node, shifted } = setup();
  shifted.set(node, 90);
  const flags = node.onPointerMove({ canvasX: 300, canvasY: 121 });
  assert.equal(node.slots[1].isPointerOver, true);
  assert.equal(node.isPointerOver, true);
  assert.equal(flags, 64 | 128);
});

test("a node lying on the band keeps its own clicks and drops", () => {
  const { node, shifted } = setup();
  shifted.set(node, 90);
  node.nodesHere.push(rect(290, 110, 40, 30));
  assert.equal(node.containsPoint([300, 120]), false);
  assert.equal(node.getSlotInPosition(300, 120), undefined);
  assert.equal(node.containsPoint([350, 120]), true);
});

test("the band is ignored while asked to, such as while dragging a link from an output", () => {
  const { node, shifted, state } = setup();
  shifted.set(node, 90);
  state.ignoreRows = true;
  assert.equal(node.containsPoint([300, 120]), false);
  assert.equal(node.getSlotInPosition(300, 120), undefined);
  assert.equal(node.getSlotInPosition(470, 121), node.slots[1]);
});

test("rows are taller and only dot-wide while shifted", () => {
  const { node, shifted } = setup();
  assert.deepEqual(node.slots[0].measure(), [60, 20]);
  shifted.set(node, 90);
  assert.deepEqual(node.slots[0].measure(), [28, 28]);
});

test("long labels no longer move the pins, and the frontend's own layout is saved", () => {
  const { node, shifted } = setup();
  node.slots[1].labelWidth = 200;
  node.arrange();
  node.arrange();
  const frontend = JSON.stringify(node.save());
  assert.deepEqual(node.boundingRect.slice(2), [248, 68]);
  shifted.set(node, 90);
  // Saved between shifting and the next arrange.
  assert.equal(JSON.stringify(node.save()), frontend);
  node.arrange();
  assert.deepEqual(node.boundingRect.slice(2), [128, 84]);
  assert.deepEqual(node.slots.map((s) => s.pos), [[400 + 128 - 14 - 14, 80 + 14 + 14], [400 + 128 - 14 - 14, 80 + 14 + 42]]);
  assert.equal(JSON.stringify(node.save()), frontend);
  // The first arrange after the rows go away already lays out as the frontend does.
  shifted.delete(node);
  node.arrange();
  assert.equal(JSON.stringify(node.save()), frontend);
});

test("a left press on a control goes to the control, and any other press to the slot", () => {
  const { node, shifted, state } = setup();
  shifted.set(node, 90);
  state.controlAt = 450;
  const pointer = {};
  node.onPointerDown({ button: 0, canvasX: 450, canvasY: 101 }, pointer);
  assert.deepEqual(state.presses, [pointer]);
  assert.deepEqual(node.downs, []);
  node.onPointerDown({ button: 2, canvasX: 450, canvasY: 101 }, pointer);
  node.onPointerDown({ button: 0, canvasX: 300, canvasY: 101 }, pointer);
  assert.equal(state.presses.length, 1);
  assert.equal(node.downs.length, 2);
});

test("bands are drawn under the boundary and controls over it, only while shifted", () => {
  const { node, shifted } = setup();
  const calls = [];
  const ctx = new Proxy({ calls }, {
    get: (target, name) => (name in target ? target[name] : () => calls.push(name)),
    set: () => true,
  });
  node.draw(ctx);
  assert.deepEqual(calls, ["boundary"]);
  calls.length = 0;
  shifted.set(node, 90);
  node.draw(ctx);
  assert.deepEqual(calls.filter((c) => !["save", "restore", "beginPath", "roundRect"].includes(c)), ["fill", "fill", "fill", "fill", "boundary", "controls"]);
});
