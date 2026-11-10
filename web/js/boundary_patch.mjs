// While a subgraph's input boundary shows the value rows, its labels are drawn
// left-aligned at the start of each row on a band reaching to the pin, and the whole
// row acts as the slot for hovering, dragging a link, renaming and the context menu.
// Only drawing and hit testing change. Rows are taller too; the frontend sizes the boundary from them
// every frame, so the boundary is saved as the frontend itself would lay it out.

export const INPUT_WIDTH = 150;
export const ROW_HEIGHT = 28;
const BAND_HEIGHT = 24;

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
  return { y, bandLeft: labelLeft - 6, bandRight, labelLeft, inputLeft, inputRight };
}

function inRow(slot, labelWidth, x, y) {
  const { bandLeft } = rowGeometry(slot, labelWidth);
  return x >= bandLeft && x <= slot.pos[0] + 10 && Math.abs(y - slot.pos[1]) <= ROW_HEIGHT / 2;
}

function ownerOf(object, name) {
  let proto = Object.getPrototypeOf(object);
  while (!Object.hasOwn(proto, name)) proto = Object.getPrototypeOf(proto);
  return proto;
}

function wrap(proto, name, make) {
  proto[name] = make(proto[name]);
}

// `slot` must be a real input slot: EmptySubgraphInput has its own labelPos.
// `shifted` maps each input node showing rows to its label column width. `hooks`:
// - ignoreRows(): true while the rows must not catch the pointer
// - bandColors(): the canvas color and the tint laid over it for the bands
// - drawControls(ctx, node): draws what sits on the bands, over the boundary
// - pressControl(node, e, pointer): takes a left press on a control and returns true
export function installBoundaryPatch(slot, inputNode, shifted, hooks) {
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
    }
  );
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

  // The bands are opaque, so the grid does not show through, and drawn before the
  // boundary so its labels and pins sit on top. The controls go over everything.
  wrap(nodeProto, "draw", (base) =>
    function (ctx, ...rest) {
      if (shifted.has(this)) {
        const [canvasColor, tint] = hooks.bandColors();
        ctx.save();
        for (const slot of this.slots) {
          const { y, bandLeft, bandRight } = rowGeometry(slot, shifted.get(this));
          ctx.beginPath();
          ctx.roundRect(bandLeft, y - BAND_HEIGHT / 2, bandRight - bandLeft, BAND_HEIGHT, 5);
          ctx.globalAlpha = 1;
          ctx.fillStyle = canvasColor;
          ctx.fill();
          ctx.globalAlpha = 0.07;
          ctx.fillStyle = tint;
          ctx.fill();
        }
        ctx.restore();
      }
      base.call(this, ctx, ...rest);
      if (shifted.has(this)) hooks.drawControls(ctx, this);
    }
  );

  // A node lying on a band keeps its own clicks and link drops.
  const rowAt = (node, x, y) => {
    if (!shifted.has(node) || hooks.ignoreRows() || node.subgraph.getNodeOnPos(x, y)) return undefined;
    return node.slots.find((s) => inRow(s, shifted.get(node), x, y));
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
  // A left press on a control is the control's. Otherwise onPointerDown checks each
  // slot's own rect directly, so a press on the row is handed over as a press on the slot dot.
  wrap(nodeProto, "onPointerDown", (base) =>
    function (e, pointer, ...rest) {
      const slot = rowAt(this, e.canvasX, e.canvasY);
      if (slot && e.button === 0 && hooks.pressControl(this, e, pointer)) return;
      if (!slot || slot.boundingRect.containsXy(e.canvasX, e.canvasY)) return base.call(this, e, pointer, ...rest);
      const { canvasX, canvasY } = e;
      e.canvasX = slot.pos[0];
      e.canvasY = slot.pos[1];
      const result = base.call(this, e, pointer, ...rest);
      e.canvasX = canvasX;
      e.canvasY = canvasY;
      return result;
    }
  );
}
