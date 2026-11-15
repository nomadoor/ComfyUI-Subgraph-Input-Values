// While a subgraph's input boundary shows the value rows, its labels are drawn
// left-aligned at the start of each row on a band reaching to the pin; rows are taller
// too. The frontend sizes the boundary from them every frame, so the boundary is saved as
// the frontend itself would lay it out. The output boundary gets bands from its pins to
// past its labels. On both, the whole row acts as the slot for hovering, link drops and
// the context menu; a link is dragged only from the pin, and a label only takes a
// double-click, to rename. Each band has a grip: dragging it moves the row among the
// others, and dropping it asks for the slot to be moved there.

export const INPUT_WIDTH = 150;
export const ROW_HEIGHT = 28;
const BAND_HEIGHT = 24;
const GRIP_WIDTH = 10;
const GROUP_GAP = 14;
const GRIP_ALPHA = 0.25;
const GRIP_HOVER_ALPHA = 0.6;

// CanvasItem flags in litegraph's globalEnums.ts.
const SUBGRAPH_IO_NODE = 1 << 6;
const SUBGRAPH_IO_SLOT = 1 << 7;

// Row layout in canvas units, measured left from the slot dot. The label column is
// as wide as the boundary's longest label, so labels sit as close to the pins as they can.
export function rowGeometry(slot, labelWidth) {
  const [dotX, y] = slot.pos;
  const bandRight = dotX - 9;
  const inputRight = bandRight - 3;
  const inputLeft = inputRight - INPUT_WIDTH;
  const labelLeft = inputLeft - labelWidth;
  const bandLeft = labelLeft - 6 - GRIP_WIDTH;
  return { y, bandLeft, bandRight, gripX: bandLeft + 5, labelLeft, inputLeft, inputRight };
}

// An output's band starts at its pin and reaches past the label, which the frontend
// draws a row's height right of the slot's left edge; the grip ends the band.
export function outputGeometry(slot, bandWidth) {
  const [dotX, y] = slot.pos;
  const bandLeft = dotX + 6;
  const bandRight = bandLeft + bandWidth;
  return { y, bandLeft, bandRight, gripX: bandRight - 11 };
}

const inputRows = {
  geometry: rowGeometry,
  height: () => BAND_HEIGHT,
  inRow: (slot, g, x, y) => x >= g.bandLeft && x <= slot.pos[0] + 10 && Math.abs(y - g.y) <= ROW_HEIGHT / 2,
  inGrip: (g, x) => x >= g.bandLeft && x < g.labelLeft - 2,
  // While shifted, an input slot's own rect is only its dot.
  onPin: (slot, x, y) => slot.boundingRect.containsXy(x, y),
};

const outputRows = {
  geometry: outputGeometry,
  height: (slot) => slot.boundingRect[3] - 4,
  inRow: (slot, g, x, y) => x >= slot.pos[0] - 10 && x <= g.bandRight && Math.abs(y - g.y) <= slot.boundingRect[3] / 2,
  inGrip: (g, x) => x >= g.gripX - 3 && x <= g.bandRight,
  onPin: (slot, x) => x <= slot.pos[0] + 8,
};

// Two columns of three dots, like the grips in the frontend's side panel.
function drawGrip(ctx, x, y) {
  ctx.beginPath();
  for (const dx of [0, 4]) {
    for (const dy of [-4, 0, 4]) {
      ctx.moveTo(x + dx + 1.2, y + dy);
      ctx.arc(x + dx, y + dy, 1.2, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function ownerOf(object, name) {
  let proto = Object.getPrototypeOf(object);
  while (!Object.hasOwn(proto, name)) proto = Object.getPrototypeOf(proto);
  return proto;
}

function wrap(proto, name, make) {
  proto[name] = make(proto[name]);
}

// Drags a row by its grip. `drag` holds the boundary node, the slot, its index, the
// pointer's offset from the row's top, the pointer's y, and the index it would be
// dropped at. `move(node, from, to)` is called on a drop at another place.
function createRowDrag(hooks, move) {
  let drag = null;
  let stopWatching = null;

  function end() {
    const node = drag?.node;
    drag = null;
    stopWatching?.();
    // Back to the frontend's layout before anything can save the dragged one.
    node?.arrange();
    hooks.redraw();
  }

  return {
    get current() {
      return drag;
    },

    start(node, slot, e, pointer) {
      const from = node.slots.indexOf(slot);
      pointer.onClick = () => {};
      pointer.onDragStart = () => {
        drag = { node, slot, from, grab: e.canvasY - slot.boundingRect[1], y: e.canvasY, to: from };
        stopWatching = hooks.watchEscape(end);
      };
      pointer.onDrag = (moveEvent) => {
        if (!drag) return;
        drag.y = moveEvent.canvasY;
        hooks.redraw();
      };
      // The drop is laid out once more from where the pointer was released: the canvas
      // may not have drawn since the last move.
      pointer.onDragEnd = (up) => {
        if (!drag) return;
        drag.y = up.canvasY;
        node.arrange();
        const { from: was, to } = drag;
        end();
        if (to !== was) move(node, was, to);
      };
      pointer.finally = () => {
        if (drag) end();
      };
    },

    // Lays `groups` (lists of the node's slots, in display order) out from `top0`,
    // `pitch` apart with `gap` between groups, through `place(slot, top)`. A dragged row
    // follows the pointer within its group while the others close up around the place
    // it would land.
    layout(node, groups, top0, pitch, gap, place) {
      const starts = [];
      let count = 0;
      for (const group of groups) {
        starts.push(count);
        count += group.length;
      }
      const topAt = (j) => top0 + j * pitch + gap * starts.filter((start) => start > 0 && j >= start).length;
      const held = drag?.node === node ? drag : null;
      if (held) {
        const index = groups.findIndex((group) => group.includes(held.slot));
        const group = groups[index];
        const k = Math.min(Math.max(Math.round((held.y - held.grab - topAt(starts[index])) / pitch), 0), group.length - 1);
        held.to = node.slots.indexOf(group[k]);
        group.splice(group.indexOf(held.slot), 1);
        group.splice(k, 0, held.slot);
      }
      groups.flat().forEach((s, j) => place(s, held?.slot === s ? held.y - held.grab : topAt(j)));
    },
  };
}

// The shared part of both boundaries: bands with grips under the boundary, the row as
// the slot for hovering and drops, presses split between grip, pin and label, and the
// cursor. `shifted` maps each node showing bands to the width its geometry needs.
function patchRows(nodeProto, rows, shifted, hooks, rowDrag) {
  const geometry = (node, slot) => rows.geometry(slot, shifted.get(node));

  // The bands are opaque, so the grid does not show through, and drawn before the
  // boundary so its labels and pins sit on top.
  wrap(nodeProto, "draw", (base) =>
    function (ctx, ...rest) {
      if (shifted.has(this)) {
        const [canvasColor, tint] = hooks.bandColors();
        ctx.save();
        for (const slot of this.slots) {
          const { y, bandLeft, bandRight, gripX } = geometry(this, slot);
          const height = rows.height(slot);
          ctx.beginPath();
          ctx.roundRect(bandLeft, y - height / 2, bandRight - bandLeft, height, 5);
          ctx.globalAlpha = 1;
          ctx.fillStyle = canvasColor;
          ctx.fill();
          ctx.globalAlpha = 0.07;
          ctx.fillStyle = tint;
          ctx.fill();
          ctx.globalAlpha = slot.isPointerOver || rowDrag.current?.slot === slot ? GRIP_HOVER_ALPHA : GRIP_ALPHA;
          drawGrip(ctx, gripX, y);
        }
        ctx.restore();
      }
      base.call(this, ctx, ...rest);
    }
  );

  // A node lying on a band keeps its own clicks and link drops.
  const rowAt = (node, x, y) => {
    if (!shifted.has(node) || hooks.ignoreRows()) return undefined;
    const slot = node.slots.find((s) => rows.inRow(s, geometry(node, s), x, y));
    return slot && !node.subgraph.getNodeOnPos(x, y) ? slot : undefined;
  };

  wrap(nodeProto, "containsPoint", (base) =>
    function (point) {
      return base.call(this, point) || !!rowAt(this, point[0], point[1]);
    }
  );
  wrap(nodeProto, "getSlotInPosition", (base) =>
    function (x, y) {
      return base.call(this, x, y) ?? rowAt(this, x, y);
    }
  );
  wrap(nodeProto, "onPointerMove", (base) =>
    function (e) {
      const result = base.call(this, e);
      const slot = rowAt(this, e.canvasX, e.canvasY);
      if (!slot) return result;
      slot.isPointerOver = true;
      if (!this.isPointerOver) this.onPointerEnter();
      return result | SUBGRAPH_IO_NODE | SUBGRAPH_IO_SLOT;
    }
  );
  // A left press on a grip drags the row, and one on a control is the control's. A left
  // press elsewhere on the row starts no link (a pin sits right next to it), but a
  // double-click renames. Other presses are handed over as presses on the slot dot,
  // since onPointerDown checks each slot's own rect directly.
  wrap(nodeProto, "onPointerDown", (base) =>
    function (e, pointer, ...rest) {
      const slot = rowAt(this, e.canvasX, e.canvasY);
      if (slot && e.button === 0 && rows.inGrip(geometry(this, slot), e.canvasX)) return rowDrag.start(this, slot, e, pointer);
      if (slot && e.button === 0 && hooks.pressControl?.(this, e, pointer)) return;
      if (!slot || rows.onPin(slot, e.canvasX, e.canvasY)) return base.call(this, e, pointer, ...rest);
      if (e.button === 0) {
        // Taking the drag keeps the canvas from moving the boundary or the selection instead.
        pointer.onDragStart = () => {};
        pointer.onDragEnd = () => {};
        pointer.onDoubleClick = () => this.handleSlotDoubleClick(slot, e);
        return;
      }
      const { canvasX, canvasY } = e;
      e.canvasX = slot.pos[0];
      e.canvasY = slot.pos[1];
      const result = base.call(this, e, pointer, ...rest);
      e.canvasX = canvasX;
      e.canvasY = canvasY;
      return result;
    }
  );

  return {
    dragging: () => !!rowDrag.current,
    // The cursor to show instead of the canvas's own, or null: a hand on a grip, and
    // the plain arrow on the rest of a row, which is not a pin.
    cursorAt(node, x, y) {
      if (rowDrag.current) return "grabbing";
      const slot = rowAt(node, x, y);
      if (!slot || rows.onPin(slot, x, y)) return null;
      return rows.inGrip(geometry(node, slot), x) ? "grab" : "default";
    },
  };
}

// `slot` must be a real input slot: EmptySubgraphInput has its own labelPos.
// `shifted` maps each input node showing rows to its label column width. `hooks`:
// - ignoreRows(): true while the rows must not catch the pointer
// - bandColors(): the canvas color and the tint laid over it for the bands
// - drawControls(ctx, node): draws what sits on the bands, over the boundary
// - pressControl(node, e, pointer): takes a left press on a control and returns true
// - moveInput(node, from, to): a row was dropped at another place
// - hasWidget(slot): whether the row's input has a widget on the subgraph node outside,
//   which decides its group
// - redraw(): the canvas must draw again
// - watchEscape(cancel): calls cancel on Escape until the returned function is called
export function installBoundaryPatch(slot, inputNode, shifted, hooks) {
  const rowDrag = createRowDrag(hooks, hooks.moveInput);
  const slotProto = ownerOf(slot, "labelPos");
  const { get } = Object.getOwnPropertyDescriptor(slotProto, "labelPos");
  Object.defineProperty(slotProto, "labelPos", {
    configurable: true,
    get() {
      return shifted.has(this.parent) ? [rowGeometry(this, shifted.get(this.parent)).labelLeft, this.pos[1]] : get.call(this);
    },
  });

  // While shifted, every row is ROW_HEIGHT tall and only as wide as its dot, so the
  // boundary keeps the frontend's minimum width: the bracket and pins stay put however
  // long the labels get, and the label column grows to the left instead.
  let frontendPass = false;
  wrap(ownerOf(slot, "measure"), "measure", (base) =>
    function () {
      const size = base.call(this);
      return shifted.has(this.parent) && !frontendPass ? [ROW_HEIGHT, ROW_HEIGHT] : size;
    }
  );

  // The boundary's size and its slots' positions are saved, so what gets saved is the
  // frontend's own layout. Each arrange places the slots from the width the previous one
  // left, so each layout is run twice to settle.
  const frontendLayout = new WeakMap();
  const nodeProto = Object.getPrototypeOf(inputNode);
  wrap(nodeProto, "arrange", (base) =>
    function () {
      if (!shifted.has(this)) {
        // Right after the rows go away, the frontend would place the slots from the rows' width.
        if (frontendLayout.delete(this)) base.call(this);
        return base.call(this);
      }
      frontendPass = true;
      base.call(this);
      base.call(this);
      frontendPass = false;
      frontendLayout.set(this, { size: [...this.size], pos: new Map(this.allSlots.map((s) => [s, [...s.pos]])) });
      base.call(this);
      base.call(this);
      layoutRows(this);
    }
  );

  // The subgraph node outside shows inputs without a widget first and those with one
  // after them, so the rows are shown in the same two groups, with a gap between them.
  function layoutRows(node) {
    const rects = new Map(node.allSlots.map((s) => [s, [...s.boundingRect]]));
    const groups = [node.slots.filter((s) => !hooks.hasWidget(s)), node.slots.filter((s) => hooks.hasWidget(s))].filter((g) => g.length);
    const gap = groups.length > 1 ? GROUP_GAP : 0;
    const place = (s, top) => {
      const [left, , width, height] = rects.get(s);
      s.arrange([left + width, top, width, height]);
    };
    rowDrag.layout(node, groups, rects.get(node.slots[0])[1], ROW_HEIGHT, gap, place);
    if (!gap) return;
    place(node.emptySlot, rects.get(node.emptySlot)[1] + gap);
    node.size = [node.size[0], node.size[1] + gap];
  }

  wrap(nodeProto, "asSerialisable", (base) =>
    function () {
      const data = base.call(this);
      const layout = frontendLayout.get(this);
      if (layout) data.bounding.splice(2, 2, ...layout.size);
      return data;
    }
  );
  wrap(ownerOf(slot, "asSerialisable"), "asSerialisable", (base) =>
    function () {
      const data = base.call(this);
      const pos = frontendLayout.get(this.parent)?.pos.get(this);
      if (pos) data.pos = [...pos];
      return data;
    }
  );

  // The controls go over everything.
  wrap(nodeProto, "draw", (base) =>
    function (ctx, ...rest) {
      base.call(this, ctx, ...rest);
      if (shifted.has(this)) hooks.drawControls(ctx, this);
    }
  );

  return patchRows(nodeProto, inputRows, shifted, hooks, rowDrag);
}

// `shifted` maps each output node showing bands to its band width. `hooks` as for the
// input boundary, with moveOutput(node, from, to) and without the control hooks. Rows
// keep the frontend's layout; while one is dragged, that layout is what gets saved.
export function installOutputPatch(outputNode, shifted, hooks) {
  const rowDrag = createRowDrag(hooks, hooks.moveOutput);
  const nodeProto = Object.getPrototypeOf(outputNode);
  const frontendPos = new WeakMap();
  wrap(nodeProto, "arrange", (base) =>
    function () {
      base.call(this);
      if (rowDrag.current?.node !== this) return frontendPos.delete(this);
      frontendPos.set(this, new Map(this.slots.map((s) => [s, [...s.pos]])));
      const rects = new Map(this.slots.map((s) => [s, [...s.boundingRect]]));
      const [, top0, , pitch] = rects.get(this.slots[0]);
      rowDrag.layout(this, [[...this.slots]], top0, pitch, 0, (s, top) => {
        const [left, , width, height] = rects.get(s);
        s.arrange([left, top, width, height]);
      });
    }
  );
  wrap(ownerOf(outputNode.slots[0], "asSerialisable"), "asSerialisable", (base) =>
    function () {
      const data = base.call(this);
      const pos = frontendPos.get(this.parent)?.get(this);
      if (pos) data.pos = [...pos];
      return data;
    }
  );
  return patchRows(nodeProto, outputRows, shifted, hooks, rowDrag);
}
