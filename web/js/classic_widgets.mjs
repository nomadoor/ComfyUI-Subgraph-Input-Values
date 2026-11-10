// Classic rows are the frontend's own widgets, drawn on the band and operated as on a
// node: the arrows, dragging, the value prompt and the combo menu all come from the
// widget classes, so they look and behave like the frontend's. A promoted widget is a
// plain descriptor; like the canvas, this wraps it in its widget class for each draw and
// press, and the class writes back through the descriptor's callback.

import { isLocked, widgetPointerX } from "./widget_values.mjs";

const classes = new Map();

// The widget classes are not exported, but a node builds one for each widget it adds.
function widgetClass(widget) {
  if (widget.drawWidget) return widget.constructor;
  if (!classes.has(widget.type)) {
    const probe = new window.LGraphNode("");
    classes.set(widget.type, probe.addWidget(widget.type, widget.type, "", null, { values: [] }).constructor);
  }
  return classes.get(widget.type);
}

// `rect` is the box in canvas units; a widget draws its box inside a margin on each side.
export function drawWidget(ctx, widget, node, rect, showText) {
  const Widget = widgetClass(widget);
  const copy = new Widget(widget, node);
  copy.label = " "; // the row already shows the slot's label
  ctx.save();
  ctx.translate(rect.x - Widget.margin, rect.y - copy.y);
  ctx.strokeStyle = window.LiteGraph.WIDGET_OUTLINE_COLOR;
  ctx.fillStyle = "#222";
  ctx.textAlign = "left";
  if (isLocked(widget.options)) ctx.globalAlpha *= 0.5;
  copy.drawWidget(ctx, { width: rect.width + 2 * Widget.margin, showText });
  ctx.restore();
}

// Sets up `pointer` the way LGraphCanvas.processWidgetClick does. The classes measure a
// press from the node's left edge across the node's width, so each event is moved there.
// `boundary` is the input node the row is on: a click selects it, as a click on one of its
// slots does, and dragging the widget never moves it.
export function pressWidget(canvas, widget, node, rect, e, pointer, boundary, onChange) {
  const Widget = widgetClass(widget);
  const target = widget.drawWidget ? widget : new Widget(widget, node);
  const left = rect.x - Widget.margin;
  const width = rect.width + 2 * Widget.margin;
  const onNode = (event, handle) => {
    const { canvasX } = event;
    event.canvasX = node.pos[0] + widgetPointerX(canvasX - left, width, node.size[0]);
    handle();
    event.canvasX = canvasX;
  };
  const before = widget.value;
  pointer.onClick = () => {
    canvas.processSelect(boundary, e);
    onNode(e, () => target.onClick({ e, node, canvas }));
  };
  pointer.onDragStart = () => {};
  pointer.onDrag = (move) => onNode(move, () => target.onDrag?.({ e: move, node, canvas }));
  pointer.finally = () => {
    if (widget.value !== before) onChange();
  };
}
