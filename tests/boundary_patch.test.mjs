import { test } from "node:test";
import assert from "node:assert/strict";

import { installBoundaryPatch, installOutputPatch, outputGeometry, rowGeometry } from "../web/js/boundary_patch.js";

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
  // Same as SubgraphInput.arrange: the rect hangs from its right edge.
  arrange([right, top, width, height]) {
    this.boundingRect = rect(right - width, top, width, height);
    this.pos = [right - height / 2, top + height / 2];
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
    this.emptySlot = new FakeSlotBase(this, 500, 300, 0);
    this.boundingRect = rect(400, 80, 120, 60);
    this.isPointerOver = false;
    this.downs = [];
    this.nodesHere = [];
    this.subgraph = { getNodeOnPos: (x, y) => this.nodesHere.find((r) => r.containsXy(x, y)) ?? null };
  }
  get size() {
    return this.boundingRect.slice(2);
  }
  set size([width, height]) {
    this.boundingRect[2] = width;
    this.boundingRect[3] = height;
  }
  get allSlots() {
    return [...this.slots, this.emptySlot];
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
      slot.arrange([right, top, w, h]);
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
  handleSlotDoubleClick(slot) {
    this.renamed = slot;
  }
  draw(ctx) {
    ctx.calls.push("boundary");
  }
}

function setup() {
  const shifted = new WeakMap();
  const node = new FakeNode();
  const state = { ignoreRows: false, controlAt: null, presses: [], moves: [], redraws: 0, cancel: null, widgetSlots: null };
  const patch = installBoundaryPatch(node.slots[0], node, shifted, {
    ignoreRows: () => state.ignoreRows,
    bandColors: () => ["#111", "#eee"],
    drawControls: (ctx) => ctx.calls.push("controls"),
    pressControl: (n, e, pointer) => {
      if (e.canvasX !== state.controlAt) return false;
      state.presses.push(pointer);
      return true;
    },
    moveInput: (n, from, to) => state.moves.push([n, from, to]),
    redraw: () => state.redraws++,
    hasWidget: (slot) => state.widgetSlots?.has(slot) ?? true,
    watchEscape: (cancel) => {
      state.cancel = cancel;
      return () => (state.cancel = null);
    },
  });
  return { node, shifted, state, patch };
}

test("rowGeometry lays out label, input and band from the slot dot and the label width", () => {
  const g = rowGeometry({ pos: [500, 100] }, 90);
  assert.deepEqual(g, { y: 100, bandLeft: 232, bandRight: 491, gripX: 237, labelLeft: 248, inputLeft: 338, inputRight: 488 });
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

test("a left press on a label starts no link; a double-click renames the slot", () => {
  const { node, shifted } = setup();
  shifted.set(node, 90);
  const pointer = {};
  node.onPointerDown({ button: 0, canvasX: 300, canvasY: 101 }, pointer);
  assert.deepEqual(node.downs, []);
  // A drag is taken and does nothing, so the canvas does not move the boundary instead.
  assert.equal(pointer.onDragStart(), undefined);
  assert.equal(pointer.onDragEnd(), undefined);
  pointer.onDoubleClick();
  assert.equal(node.renamed, node.slots[0]);
});

test("a right press on a label acts as one on its slot, for the slot menu", () => {
  const { node, shifted } = setup();
  shifted.set(node, 90);
  const e = { button: 2, canvasX: 300, canvasY: 101 };
  node.onPointerDown(e, {});
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
  assert.equal(state.presses.length, 1);
  assert.equal(node.downs.length, 1);
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
  // Per row: the band, its tint and the grip.
  assert.deepEqual(calls.filter((c) => !["save", "restore", "beginPath", "roundRect", "moveTo", "arc"].includes(c)), ["fill", "fill", "fill", "fill", "fill", "fill", "boundary", "controls"]);
});

// Three rows 28 apart once shifted and arranged: tops 94, 122, 150.
function shiftedThree() {
  const setupResult = setup();
  const { node, shifted } = setupResult;
  node.slots.push(new FakeSlot(node, 500, 140, 40));
  shifted.set(node, 90);
  node.arrange();
  return setupResult;
}
const gripPress = (node, i) => {
  const slot = node.slots[i];
  return { button: 0, canvasX: rowGeometry(slot, 90).gripX, canvasY: slot.pos[1] };
};

test("a left press on the grip starts no link, and a click alone does nothing", () => {
  const { node, state } = shiftedThree();
  const pointer = {};
  node.onPointerDown(gripPress(node, 0), pointer);
  pointer.onClick?.();
  pointer.finally?.();
  assert.deepEqual(node.downs, []);
  assert.deepEqual(state.moves, []);
});

test("dragging a row by its grip moves it among the rows and reorders on release", () => {
  const { node, state } = shiftedThree();
  const [a, b, c] = node.slots;
  const pointer = {};
  const press = gripPress(node, 0);
  node.onPointerDown(press, pointer);
  pointer.onDragStart();
  pointer.onDrag({ canvasY: press.canvasY + 60 });
  node.arrange();
  assert.equal(a.pos[1], press.canvasY + 60, "the held row follows the pointer");
  assert.deepEqual([b.pos[1], c.pos[1]], [108, 136], "the others close up, leaving a gap at the bottom");
  assert.ok(state.redraws > 0);
  pointer.onDragEnd({ canvasY: press.canvasY + 60 });
  pointer.finally?.();
  assert.deepEqual(state.moves, [[node, 0, 2]]);
  node.arrange();
  assert.deepEqual(node.slots.map((s) => s.pos[1]), [108, 136, 164], "the layout is the frontend's again");
});

test("dropping a row back on its own place does not reorder", () => {
  const { node, state } = shiftedThree();
  const pointer = {};
  const press = gripPress(node, 1);
  node.onPointerDown(press, pointer);
  pointer.onDragStart();
  pointer.onDrag({ canvasY: press.canvasY + 5 });
  node.arrange();
  pointer.onDragEnd({ canvasY: press.canvasY + 5 });
  pointer.finally?.();
  assert.deepEqual(state.moves, []);
});

test("Escape during a drag puts the row back and does not reorder", () => {
  const { node, state } = shiftedThree();
  const pointer = {};
  const press = gripPress(node, 2);
  node.onPointerDown(press, pointer);
  pointer.onDragStart();
  pointer.onDrag({ canvasY: press.canvasY - 60 });
  state.cancel();
  node.arrange();
  assert.deepEqual(node.slots.map((s) => s.pos[1]), [108, 136, 164]);
  pointer.onDragEnd({ canvasY: press.canvasY - 60 });
  pointer.finally?.();
  assert.deepEqual(state.moves, []);
  assert.equal(state.cancel, null, "Escape is no longer watched");
});

test("the cursor is a hand over a grip and a closed hand while dragging", () => {
  const { node, patch } = shiftedThree();
  const press = gripPress(node, 0);
  assert.equal(patch.cursorAt(node, press.canvasX, press.canvasY), "grab");
  assert.equal(patch.cursorAt(node, press.canvasX + 40, press.canvasY), "default", "a label is not a pin");
  const dot = node.slots[0].pos;
  assert.equal(patch.cursorAt(node, dot[0], dot[1]), null);
  const pointer = {};
  node.onPointerDown(press, pointer);
  pointer.onDragStart();
  assert.equal(patch.cursorAt(node, press.canvasX + 40, press.canvasY), "grabbing");
  pointer.onDragEnd({ canvasY: press.canvasY });
  assert.equal(patch.cursorAt(node, press.canvasX + 40, press.canvasY), "default");
});

test("rows without a widget come first, then a gap, then rows with one, as on the node outside", () => {
  const { node, state } = shiftedThree();
  node.slots.push(new FakeSlot(node, 500, 160, 40));
  const [a, b, c, d] = node.slots;
  state.widgetSlots = new Set([b, d]);
  node.arrange();
  // Tops 94, 122, then 14 lower: 164, 192.
  assert.deepEqual([a, c, b, d].map((s) => s.pos[1]), [108, 136, 178, 206]);
  assert.equal(node.size[1], 4 * 28 + 2 * 14 + 14);
});

test("a row moves only within its own group", () => {
  const { node, state } = shiftedThree();
  node.slots.push(new FakeSlot(node, 500, 160, 40));
  const [a, b, c, d] = node.slots;
  state.widgetSlots = new Set([b, d]);
  node.arrange();
  const pointer = {};
  const press = gripPress(node, 3);
  node.onPointerDown(press, pointer);
  pointer.onDragStart();
  pointer.onDrag({ canvasY: press.canvasY - 150 });
  node.arrange();
  assert.deepEqual([a.pos[1], c.pos[1], b.pos[1]], [108, 136, 206], "dragged to the top, it stops at the top of its group");
  pointer.onDragEnd({ canvasY: press.canvasY - 150 });
  assert.deepEqual(state.moves, [[node, 3, 1]]);
});

test("a drop with no draw since the last move lands where the pointer was released", () => {
  const { node, state } = shiftedThree();
  const pointer = {};
  const press = gripPress(node, 0);
  node.onPointerDown(press, pointer);
  pointer.onDragStart();
  pointer.onDrag({ canvasY: press.canvasY + 20 });
  pointer.onDragEnd({ canvasY: press.canvasY + 60 });
  assert.deepEqual(state.moves, [[node, 0, 2]]);
});

test("a drag ended only by finally, as when the pointer is reset, stops watching Escape and moves nothing", () => {
  const { node, state } = shiftedThree();
  const pointer = {};
  const press = gripPress(node, 0);
  node.onPointerDown(press, pointer);
  pointer.onDragStart();
  pointer.onDrag({ canvasY: press.canvasY + 60 });
  pointer.finally();
  assert.equal(state.cancel, null);
  node.arrange();
  assert.deepEqual(node.slots.map((s) => s.pos[1]), [108, 136, 164]);
  assert.deepEqual(state.moves, []);
});

test("there is no gap when every row is of one kind", () => {
  const { node, state } = shiftedThree();
  state.widgetSlots = new Set();
  node.arrange();
  assert.deepEqual(node.slots.map((s) => s.pos[1]), [108, 136, 164]);
  assert.equal(node.size[1], 3 * 28 + 2 * 14);
});

// Stand-ins for SubgraphOutput and SubgraphOutputNode: pins on the left, each slot's rect
// covering its label to the right, 20 tall.
class FakeOutput {
  constructor(parent, left, top) {
    this.parent = parent;
    this.arrange([left, top, 60, 20]);
    this.isPointerOver = false;
  }
  arrange([left, top, width, height]) {
    this.boundingRect = rect(left, top, width, height);
    this.pos = [left + height / 2, top + height / 2];
  }
  asSerialisable() {
    return { pos: [...this.pos] };
  }
}
class FakeOutputNode {
  constructor() {
    this.slots = [new FakeOutput(this, 600, 100), new FakeOutput(this, 600, 120), new FakeOutput(this, 600, 140)];
    this.emptySlot = new FakeOutput(this, 600, 160);
    this.boundingRect = rect(586, 86, 90, 108);
    this.size = [90, 108];
    this.downs = [];
    this.isPointerOver = false;
    this.subgraph = { getNodeOnPos: () => null };
  }
  get allSlots() {
    return [...this.slots, this.emptySlot];
  }
  arrange() {
    this.allSlots.forEach((s, i) => s.arrange([600, 100 + 20 * i, 60, 20]));
    this.size = [90, 20 * this.allSlots.length + 28];
  }
  asSerialisable() {
    return { bounding: [586, 86, ...this.size] };
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
  onPointerMove() {
    return 0;
  }
  onPointerDown(e) {
    this.downs.push([e.canvasX, e.canvasY]);
  }
  handleSlotDoubleClick(slot) {
    this.renamed = slot;
  }
  draw() {}
}

function setupOutputs() {
  const shifted = new WeakMap();
  const node = new FakeOutputNode();
  const state = { moves: [], cancel: null };
  const patch = installOutputPatch(node, shifted, {
    ignoreRows: () => false,
    bandColors: () => ["#111", "#eee"],
    moveOutput: (n, from, to) => state.moves.push([n, from, to]),
    redraw: () => {},
    watchEscape: (cancel) => {
      state.cancel = cancel;
      return () => (state.cancel = null);
    },
  });
  shifted.set(node, 100);
  node.arrange();
  return { node, state, patch };
}

test("an output's band runs from its pin past the label and ends in a grip", () => {
  const { node } = setupOutputs();
  assert.deepEqual(outputGeometry(node.slots[0], 100), { y: 114, bandLeft: 616, bandRight: 716, gripX: 705 });
});

test("output rows are as far apart as the inputs, with the pins where the frontend puts them", () => {
  const { node } = setupOutputs();
  assert.deepEqual(node.allSlots.map((s) => s.pos), [[610, 114], [610, 142], [610, 170], [610, 198]]);
  assert.equal(node.size[1], 4 * 28 + 28);
  assert.deepEqual(node.slots.map((s) => s.asSerialisable().pos[1]), [110, 130, 150], "the frontend's layout is saved");
  assert.deepEqual(node.asSerialisable().bounding, [586, 86, 90, 108]);
});

test("dragging an output by its grip moves it, and its label drags nothing", () => {
  const { node, state, patch } = setupOutputs();
  const [a, b, c] = node.slots;
  const grip = { button: 0, canvasX: 706, canvasY: 170 };
  assert.equal(patch.cursorAt(node, grip.canvasX, grip.canvasY), "grab");
  const pointer = {};
  node.onPointerDown(grip, pointer);
  pointer.onDragStart();
  pointer.onDrag({ canvasY: 114 });
  node.arrange();
  assert.equal(c.pos[1], 114, "the held row follows the pointer");
  assert.deepEqual([a.pos[1], b.pos[1]], [142, 170]);
  pointer.onDragEnd({ canvasY: 114 });
  assert.deepEqual(state.moves, [[node, 2, 0]]);
  assert.deepEqual(node.slots.map((s) => s.pos[1]), [114, 142, 170], "the rows are back in order");

  const label = {};
  node.onPointerDown({ button: 0, canvasX: 640, canvasY: 142 }, label);
  assert.equal(patch.cursorAt(node, 640, 142), "default");
  label.onDoubleClick();
  assert.equal(node.renamed, b);
  node.onPointerDown({ button: 0, canvasX: 612, canvasY: 142 }, {});
  assert.deepEqual(node.downs, [[612, 142]], "the pin still starts a link");
  assert.equal(patch.cursorAt(node, 612, 142), null);
});

test("a dragged output is saved where the frontend lays it out", () => {
  const { node } = setupOutputs();
  const pointer = {};
  node.onPointerDown({ button: 0, canvasX: 706, canvasY: 170 }, pointer);
  pointer.onDragStart();
  pointer.onDrag({ canvasY: 114 });
  node.arrange();
  assert.equal(node.slots[2].pos[1], 114);
  assert.deepEqual(node.slots.map((s) => s.asSerialisable().pos[1]), [110, 130, 150]);
  pointer.finally();
  assert.deepEqual(node.slots.map((s) => s.asSerialisable().pos[1]), [110, 130, 150]);
});

test("a row is found before nodes on it are looked up", () => {
  const { node } = setupOutputs();
  let lookups = 0;
  node.subgraph.getNodeOnPos = () => {
    lookups++;
    return null;
  };
  node.getSlotInPosition(900, 900);
  assert.equal(lookups, 0);
});

test("the patch reports a drag in progress", () => {
  const { node, patch } = setupOutputs();
  const pointer = {};
  node.onPointerDown({ button: 0, canvasX: 706, canvasY: 170 }, pointer);
  assert.equal(patch.dragging(), false);
  pointer.onDragStart();
  assert.equal(patch.dragging(), true);
  pointer.finally();
  assert.equal(patch.dragging(), false);
});

test("removing the last input while rows are shown does not break the layout", () => {
  const { node, shifted } = setup();
  shifted.set(node, 90);
  node.arrange();
  node.slots.length = 0;
  assert.doesNotThrow(() => node.arrange());
});
