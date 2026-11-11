// Turns each row of a subgraph's input boundary into "label + input": the canvas draws
// a band from the label to the slot (see boundary_patch.mjs) and the value's editor at
// its right end. Classic rows are the frontend's own widgets drawn on the canvas (see
// classic_widgets.mjs); Nodes 2.0 rows, and multiline and read-only rows in both, are
// HTML on this layer. The row still acts as the slot; only the editors take input.

import { INPUT_WIDTH, installBoundaryPatch, rowGeometry } from "./boundary_patch.mjs";
import { buildRows } from "./boundary_rows.mjs";
import { drawWidget, pressWidget } from "./classic_widgets.mjs";
import {
  comboValues,
  constrainNumber,
  controlKind,
  firstLine,
  formatNumber,
  numberStep,
  isLocked,
  parseNumber,
  sliderPercent,
  toggleText,
} from "./widget_values.mjs";

function optionLabel(widget, value) {
  return widget.options.getOptionLabel?.(String(value)) || String(value ?? "");
}

const ROW_TOP = 12; // half the band's height
const SOURCE_FONT = "10px Inter, sans-serif";
const SOURCE_MAX = 160;
const CONTROL_HEIGHT = 20;
const VUE_CONTROL_HEIGHT = 24;
const SWIPE_THRESHOLD = 50; // VueUse's usePointerSwipe default, which the number input uses

const NUMBER_BUTTON =
  "relative inline-flex aspect-square h-full cursor-pointer touch-manipulation appearance-none items-center justify-center rounded-none border-none bg-transparent p-0 text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30";
const MENU_ITEM =
  "flex h-8 w-full cursor-pointer items-center justify-between gap-3 rounded-sm p-2 outline-none select-none hover:bg-secondary data-highlighted:bg-secondary data-[state=checked]:bg-primary/20 data-[state=checked]:hover:bg-primary/20 data-[state=checked]:data-highlighted:bg-primary/30";
const TOGGLE_ITEM =
  "inline-flex h-5 min-w-0 flex-1 cursor-pointer appearance-none items-center justify-center truncate rounded-sm border-none bg-transparent px-2 text-center text-xs font-normal text-muted-foreground transition-all duration-150 ease-in-out hover:bg-secondary/50 data-[state=on]:bg-secondary data-[state=on]:text-foreground";
const TEXT_INPUT =
  "flex h-6 w-full min-w-0 appearance-none truncate rounded-md border-none bg-input px-4 text-xs text-foreground placeholder:text-muted-foreground hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";
const LABEL_FONT = "12px Inter, sans-serif"; // the boundary's own label font
const MULTILINE_WIDTH = 240;
const MULTILINE_HEIGHT = 96;

const LABEL_GAP = 8;
// The label column fits the longest label within these bounds. Short labels never move
// it; a label past the maximum runs under its input box.
const LABEL_MIN = 80;
const LABEL_MAX = 160;

const shifted = new WeakMap();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function setStyle(node, name, value) {
  if (node.style[name] !== value) node.style[name] = value;
}

function signatureOf(host, slots, rowBySlot, vue) {
  const parts = slots.map((slot) => {
    const row = rowBySlot.get(slot);
    const name = `${slot.id}:${slot.displayName}`;
    return row ? `${name}:${row.kind}:${row.widget.type}:${row.source?.id ?? ""}` : `${name}:-`;
  });
  return `${host.id}|${vue}|${parts.join(",")}`;
}

export function createBoundaryOverlay(lgCanvas, { isVue, onCommit }) {
  const layer = el("div", "siv-layer");
  const anchor = el("div", "siv-anchor");
  layer.append(anchor);
  layer.hidden = true;
  lgCanvas.canvas.after(layer);
  layer.addEventListener(
    "wheel",
    (e) => {
      if (e.target instanceof HTMLTextAreaElement && document.activeElement === e.target) return;
      e.preventDefault();
      lgCanvas.canvas.dispatchEvent(new WheelEvent(e.type, e));
    },
    { passive: false }
  );

  // Canvas shortcuts listen on window; keep bare keys such as Delete inside the layer.
  // Fields handle Escape themselves, and the frontend ignores it there.
  layer.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === "Escape") return;
    e.stopPropagation();
  });

  // Buttons never take focus, so Space and Delete keep reaching the canvas after a click.
  // A one-line field being typed in is committed first, so a step adds to the typed value.
  layer.addEventListener("mousedown", (e) => {
    if (!e.target.closest("button")) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && layer.contains(active)) active.blur();
    e.preventDefault();
  });

  let signature = "";
  let host = null;
  let slots = [];
  let rowBySlot = new Map();
  let lines = [];
  let shiftedNode = null;
  let labelWidth = 0;
  let controlHeight = CONTROL_HEIGHT;
  let patched = false;
  let popup = null;
  let menu = null;
  let bandPalette = "";
  let bandColors = ["", ""];
  let sourceColor = "";

  // Disabled and read-only widgets are shown but never written, as on a node.
  function apply(widget, value) {
    if (isLocked(widget.options)) return;
    widget.value = value;
    widget.callback?.(value);
    lgCanvas.setDirty(true, true);
  }

  function commit(widget, value) {
    apply(widget, value);
    onCommit();
  }

  function setShift(node) {
    if (node === shiftedNode && (!node || shifted.get(node) === labelWidth)) return;
    if (shiftedNode) shifted.delete(shiftedNode);
    if (node) shifted.set(node, labelWidth);
    shiftedNode = node;
    lgCanvas.setDirty(true, true);
  }

  // Removing a focused textarea does not reliably fire change, so write what was typed first.
  function closePopup() {
    if (!popup) return;
    const area = popup;
    popup = null;
    if (area.typed()) commit(area.line.row.widget, area.value);
    area.remove();
  }

  // Each control reads its widget through `line.row`, which is refreshed every frame.

  // A field commits only what the user typed since it got focus; otherwise a field
  // left focused with an old value would write that value back on blur.
  function typedSinceFocus(input) {
    let typed = false;
    // change fires before blur, so clearing on blur never drops a commit.
    for (const type of ["focus", "blur"]) {
      input.addEventListener(type, () => {
        typed = false;
      });
    }
    input.addEventListener("input", () => {
      typed = true;
    });
    return () => typed;
  }

  // The browser keeps a text undo history for one-line fields even after they lose
  // focus; Ctrl+Z on the canvas would refocus such a field and put its old text back.
  // With it blocked, Ctrl+Z does nothing while such a field has focus, since the
  // frontend leaves keys in text fields alone.
  function blockTextUndo(input) {
    input.addEventListener("beforeinput", (e) => {
      if (e.inputType === "historyUndo" || e.inputType === "historyRedo") e.preventDefault();
    });
  }

  function textKeys(input, revert) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        revert();
        input.blur();
      } else if (e.key === "Enter" && input.tagName === "INPUT") {
        input.blur();
      }
    });
  }

  // Nodes 2.0 controls are built from the frontend's own Tailwind classes (as of 1.58.5),
  // so they take its theme. Heights are its h-6 widget height; the rest is unchanged.

  function numberControl(line) {
    const widget = () => line.row.widget;
    const step = () => numberStep(widget().options);
    const clamp = (value) => constrainNumber(value, widget().options);
    const shown = () => formatNumber(widget().value, widget().options);
    const root = el("div", "relative flex h-6 overflow-hidden rounded-md bg-input text-xs text-foreground");
    const fill = el("div", "pointer-events-none absolute size-full overflow-clip rounded-md");
    const bar = el("div", "size-full bg-primary/15");
    fill.append(bar);
    const button = (icon, sign) => {
      const b = el("button", NUMBER_BUTTON);
      b.type = "button";
      b.tabIndex = -1;
      b.append(el("i", icon));
      b.addEventListener("click", () => commit(widget(), clamp(Number(widget().value) + sign * step())));
      return b;
    };
    const dec = button("icon-[lucide--minus]", -1);
    const inc = button("icon-[lucide--plus]", 1);
    const field = el("div", "relative my-0.25 min-w-[4ch] flex-1 py-1.5");
    const input = el("input", "absolute inset-0 truncate border-0 bg-transparent p-1 text-xs focus:outline-0");
    const swipe = el("div", "absolute inset-0 z-10 cursor-ew-resize touch-pan-y");
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    field.append(input, swipe);
    root.append(fill, dec, field, inc);

    // Dragging changes the value by a step every 10 pixels; a press without a drag edits the text.
    let drag = null;
    swipe.addEventListener("pointerdown", (e) => {
      swipe.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, done: 0, far: false, before: widget().value };
    });
    swipe.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const distance = e.clientX - drag.x;
      if (Math.abs(distance) >= SWIPE_THRESHOLD) drag.far = true;
      const delta = ((distance - drag.done) / 10) | 0;
      if (!delta) return;
      drag.done += delta * 10;
      apply(widget(), clamp(Number(widget().value) + delta * step()));
    });
    const endDrag = () => {
      const ended = drag;
      drag = null;
      if (ended && widget().value !== ended.before) onCommit();
      return ended;
    };
    swipe.addEventListener("pointerup", () => {
      const ended = endDrag();
      if (!ended || ended.far || isLocked(widget().options)) return;
      swipe.hidden = true;
      input.focus();
      input.select();
    });
    // A cancelled drag ends without pointerup.
    swipe.addEventListener("lostpointercapture", endDrag);

    const typed = typedSinceFocus(input);
    blockTextUndo(input);
    input.addEventListener("change", () => {
      const parsed = parseNumber(input.value);
      if (typed() && parsed !== undefined) commit(widget(), clamp(parsed));
      input.value = shown();
    });
    input.addEventListener("blur", () => {
      swipe.hidden = false;
    });
    input.addEventListener("keydown", (e) => {
      const sign = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (!sign) return;
      e.preventDefault();
      commit(widget(), clamp(Number(widget().value) + sign * step()));
      input.value = shown();
    });
    textKeys(input, () => {
      input.value = shown();
    });
    const refresh = () => {
      const { min, max } = widget().options;
      const locked = isLocked(widget().options);
      dec.disabled = locked || (min != null && widget().value <= min);
      inc.disabled = locked || (max != null && widget().value >= max);
      input.disabled = locked;
      root.classList.toggle("opacity-50", locked);
      setStyle(bar, "width", `${sliderPercent(widget().value, widget().options)}%`);
      if (!typed() && input.value !== shown()) input.value = shown();
    };
    return { root, refresh };
  }

  // The combo menu stands in for WidgetSelectDefault's: a search field past four values,
  // the list with the current value checked, arrow keys, Enter and Escape.
  function closeMenu() {
    if (!menu) return;
    menu.root.remove();
    document.removeEventListener("pointerdown", menu.outside, true);
    menu = null;
  }

  function openMenu(line, anchorBox) {
    closeMenu();
    const widget = line.row.widget;
    const values = comboValues(widget.options, widget, line.row.source ?? host);
    const options = values.map((value) => ({ value, label: optionLabel(widget, value) }));
    const root = el("div", "z-3000 overflow-hidden rounded-lg border border-solid border-border bg-background p-0 text-foreground shadow-md outline-none");
    root.style.position = "fixed";
    root.tabIndex = -1; // takes the keys when there is no search field
    const list = el("div", "max-h-56 min-w-full scrollbar-thin scrollbar-thumb-smoke-500/50 scrollbar-track-transparent overflow-y-auto p-1 text-xs");
    let shown = options;
    let highlighted = -1;
    // Undo may have replaced the widget while the menu was open.
    const choose = (option) => {
      closeMenu();
      const current = line.row.widget;
      if (String(option.value) !== String(current.value)) commit(current, option.value);
    };
    const highlight = (index) => {
      highlighted = index;
      list.children[index]?.scrollIntoView({ block: "nearest" });
      [...list.children].forEach((item, i) => item.toggleAttribute("data-highlighted", i === index));
    };
    const render = (query) => {
      const q = query.trim().toLocaleLowerCase();
      shown = q ? options.filter((o) => String(o.value).toLocaleLowerCase().includes(q) || o.label.toLocaleLowerCase().includes(q)) : options;
      list.replaceChildren(
        ...shown.map((option) => {
          const item = el("div", MENU_ITEM);
          const checked = String(option.value) === String(widget.value);
          item.dataset.state = checked ? "checked" : "unchecked";
          item.append(el("span", "truncate", option.label));
          if (checked) item.append(el("i", "icon-[lucide--check] size-3.5 shrink-0 text-foreground"));
          item.addEventListener("pointermove", () => highlight(shown.indexOf(option)));
          item.addEventListener("click", () => choose(option));
          return item;
        })
      );
      highlight(q ? 0 : shown.findIndex((o) => String(o.value) === String(widget.value)));
    };
    let search = null;
    if (options.length > 4) {
      const box = el("div", "m-1 flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors focus-within:border-primary");
      search = el("input", "w-full border-none bg-transparent text-xs outline-none");
      search.placeholder = widget.options.filterPlaceholder ?? "";
      search.addEventListener("input", () => render(search.value));
      box.append(el("i", "icon-[lucide--search] shrink-0 text-sm text-muted-foreground"), search);
      root.append(box);
    }
    root.append(list);
    root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") closeMenu();
      else if (e.key === "Enter" && shown[highlighted]) choose(shown[highlighted]);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = highlighted + (e.key === "ArrowDown" ? 1 : -1);
        highlight(Math.min(Math.max(next, 0), shown.length - 1));
      }
    });
    const outside = (e) => {
      if (!root.contains(e.target) && !anchorBox.contains(e.target)) closeMenu();
    };
    document.addEventListener("pointerdown", outside, true);
    menu = { root, anchor: anchorBox, outside };
    render("");
    document.body.append(root);
    placeMenu();
    (search ?? root).focus({ preventScroll: true });
  }

  function placeMenu() {
    if (!menu) return;
    const rect = menu.anchor.getBoundingClientRect();
    setStyle(menu.root, "left", `${rect.left}px`);
    setStyle(menu.root, "top", `${rect.bottom + 1}px`);
    setStyle(menu.root, "minWidth", `${rect.width}px`);
    setStyle(menu.root, "maxWidth", `${Math.max(rect.width, window.innerWidth - rect.left - 8)}px`);
  }

  function comboControl(line) {
    const widget = () => line.row.widget;
    const root = el("div", "flex h-6 w-full min-w-0 items-center overflow-hidden rounded-md border-none text-xs not-disabled:bg-input not-disabled:text-foreground hover:bg-muted");
    const trigger = el("button", "flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden border-none bg-transparent p-0 text-foreground outline-none");
    const text = el("span", "min-w-[4ch] flex-1 truncate pr-1 pl-2 text-left");
    const chevron = el("button", "flex h-full w-6 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent outline-none");
    trigger.append(text);
    chevron.append(el("i", "icon-[lucide--chevron-down] size-4 bg-muted-foreground"));
    for (const b of [trigger, chevron]) {
      b.type = "button";
      b.tabIndex = -1;
      b.addEventListener("click", () => (menu?.anchor === root ? closeMenu() : openMenu(line, root)));
    }
    root.append(trigger, chevron);
    const refresh = () => {
      const locked = isLocked(widget().options);
      trigger.disabled = chevron.disabled = locked;
      root.classList.toggle("opacity-50", locked);
      setText(text, optionLabel(widget(), widget().value));
    };
    return { root, refresh };
  }

  // WidgetToggleSwitch: an off/on pair when the widget names its values, else a switch.
  function toggleControl(line) {
    const widget = () => line.row.widget;
    const set = (value) => {
      if (!!widget().value !== value) commit(widget(), value);
    };
    const { on, off } = widget().options ?? {};
    if (on != null || off != null) {
      const root = el("div", "flex h-6 w-full min-w-0 items-center justify-center gap-1 rounded-md border-none p-0.5 not-disabled:bg-input not-disabled:text-foreground");
      const items = [false, true].map((value) => {
        const item = el("button", TOGGLE_ITEM, toggleText(value, widget().options));
        item.type = "button";
        item.addEventListener("click", () => set(value));
        return item;
      });
      root.append(...items);
      const refresh = () =>
        items.forEach((item, i) => {
          item.dataset.state = !!widget().value === !!i ? "on" : "off";
          item.disabled = isLocked(widget().options);
        });
      return { root, refresh };
    }
    const root = el("div", "siv-pass flex h-6 items-center justify-end");
    const button = el("button", "group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-0 bg-transparent p-0 transition-shadow outline-none");
    const track = el("span", "pointer-events-none inline-flex h-5 w-9 items-center rounded-full border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary");
    const thumb = el("span", "pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0");
    button.type = "button";
    track.append(thumb);
    button.append(track);
    button.addEventListener("click", () => set(!widget().value));
    root.append(button);
    const refresh = () => {
      const state = widget().value ? "checked" : "unchecked";
      button.dataset.state = thumb.dataset.state = state;
      button.disabled = isLocked(widget().options);
      root.classList.toggle("opacity-50", button.disabled);
    };
    return { root, refresh };
  }

  function textControl(line) {
    const input = el("input", TEXT_INPUT);
    const current = () => line.row.widget.value ?? "";
    const typed = typedSinceFocus(input);
    blockTextUndo(input);
    input.addEventListener("change", () => {
      if (typed()) commit(line.row.widget, input.value);
    });
    textKeys(input, () => {
      input.value = current();
    });
    const refresh = () => {
      input.readOnly = isLocked(line.row.widget.options);
      if (!typed() && input.value !== current()) input.value = current();
    };
    return { root: input, refresh };
  }

  function multilineControl(line) {
    // Shaped like the multiline textarea, with the line count, so it reads differently from a one-line field.
    const box = el("button", "siv-box siv-multiline-preview");
    box.type = "button";
    const preview = el("span", "siv-preview");
    const count = el("span", "siv-lines");
    box.append(preview, count);
    box.addEventListener("click", () => {
      if (popup?.line === line) return popup.focus();
      closePopup();
      const area = el("textarea", "siv-multiline");
      area.value = line.row.widget.value ?? "";
      area.typed = typedSinceFocus(area);
      area.line = line;
      area.addEventListener("change", () => {
        if (area.typed()) commit(line.row.widget, area.value);
      });
      textKeys(area, () => {
        area.value = line.row.widget.value ?? "";
      });
      area.addEventListener("focusout", () => {
        if (popup === area) closePopup();
      });
      popup = area;
      anchor.append(area);
      area.focus({ preventScroll: true });
      area.setSelectionRange(0, 0);
    });
    const refresh = () => {
      box.disabled = isLocked(line.row.widget.options);
      const text = String(line.row.widget.value ?? "");
      setText(preview, firstLine(text));
      setText(count, `¶${text.split("\n").length}`);
    };
    return { root: box, refresh };
  }

  function plainControl(line, className, label) {
    const root = el("div", className);
    const refresh = () => setText(root, label ?? String(line.row.widget.value ?? ""));
    return { root, refresh };
  }

  function createControl(line, vue) {
    const { row } = line;
    if (row.kind === "linked") return plainControl(line, "siv-linked", "linked");
    const kind = controlKind(row.widget.type);
    if (!vue && kind !== "multiline" && kind !== "readonly") return null;
    switch (kind) {
      case "number":
        return numberControl(line);
      case "combo":
        return comboControl(line);
      case "toggle":
        return toggleControl(line);
      case "text":
        return textControl(line);
      case "multiline":
        return multilineControl(line);
      default:
        return plainControl(line, "siv-box siv-readonly");
    }
  }

  function widgetRect(line) {
    const g = rowGeometry(line.slot, labelWidth);
    const height = window.LiteGraph.NODE_WIDGET_HEIGHT;
    return { x: g.inputLeft, y: g.y - height / 2, width: INPUT_WIDTH, height };
  }

  // The source tag is drawn like the labels, so it sits on the row's middle as they do.
  function drawSource(ctx, line) {
    const { source } = line.row;
    let text = `⇠ ${source.title} #${source.id}`;
    ctx.save();
    ctx.font = SOURCE_FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = sourceColor;
    while (text.length > 1 && ctx.measureText(text).width > SOURCE_MAX) text = `${text.slice(0, -2)}…`;
    const g = rowGeometry(line.slot, labelWidth);
    ctx.fillText(text, g.bandLeft - 4, g.y);
    ctx.restore();
  }

  function drawControls(ctx) {
    for (const line of lines) {
      if (line.drawn) drawWidget(ctx, line.row.widget, line.row.source ?? host, widgetRect(line), !lgCanvas.low_quality);
      if (line.row?.source) drawSource(ctx, line);
    }
  }

  function pressControl(node, e, pointer) {
    const line = lines.find((l) => {
      if (!l.drawn) return false;
      const { x, y, width, height } = widgetRect(l);
      return e.canvasX >= x && e.canvasX <= x + width && e.canvasY >= y && e.canvasY <= y + height;
    });
    if (!line || isLocked(line.row.widget.options)) return false;
    pressWidget(lgCanvas, line.row.widget, line.row.source ?? host, widgetRect(line), e, pointer, node, onCommit);
    return true;
  }

  const measure = document.createElement("canvas").getContext("2d");
  measure.font = LABEL_FONT;

  function rebuild(vue) {
    closePopup();
    closeMenu();
    const longest = Math.max(...slots.map((slot) => measure.measureText(slot.displayName).width));
    labelWidth = Math.min(Math.max(longest + LABEL_GAP, LABEL_MIN), LABEL_MAX);
    const parts = [];
    lines = slots.map((slot) => {
      const line = { slot, row: rowBySlot.get(slot) ?? null, control: null, drawn: false };
      if (line.row) {
        line.control = createControl(line, vue);
        line.drawn = !line.control;
        if (line.control) {
          line.control.root.classList.add("siv-control");
          line.control.root.style.width = `${INPUT_WIDTH}px`;
          line.control.root.dataset.input = slot.name;
          parts.push(line.control.root);
        }
      }
      return line;
    });
    anchor.replaceChildren(...parts);
  }

  function place() {
    const rect = lgCanvas.canvas.getBoundingClientRect();
    setStyle(layer, "left", `${rect.left}px`);
    setStyle(layer, "top", `${rect.top}px`);
    setStyle(layer, "width", `${rect.width}px`);
    setStyle(layer, "height", `${rect.height}px`);
    const { offset, scale } = lgCanvas.ds;
    setStyle(anchor, "transform", `scale(${scale}) translate(${offset[0]}px, ${offset[1]}px)`);
    for (const line of lines) {
      const g = rowGeometry(line.slot, labelWidth);
      if (line.control) {
        setStyle(line.control.root, "left", `${g.inputLeft}px`);
        setStyle(line.control.root, "top", `${g.y - controlHeight / 2}px`);
      }
    }
    placeMenu();
    if (popup) {
      const g = rowGeometry(popup.line.slot, labelWidth);
      setStyle(popup, "left", `${g.inputRight - MULTILINE_WIDTH}px`);
      setStyle(popup, "top", `${g.y + ROW_TOP + 2}px`);
      setStyle(popup, "width", `${MULTILINE_WIDTH}px`);
      setStyle(popup, "height", `${MULTILINE_HEIGHT}px`);
    }
  }

  function hide() {
    closePopup();
    closeMenu();
    layer.hidden = true;
    signature = "";
    setShift(null);
  }

  return {
    update(graph, nextHost) {
      host = nextHost;
      // Undo recreates the graph objects with the same ids, so rows are read every frame.
      const rows = host ? buildRows(host, graph) : [];
      if (rows.length === 0) return hide();
      slots = graph.inputs;
      rowBySlot = new Map(rows.map((row) => [row.slot, row]));
      if (!patched) {
        // While a link is dragged from an interior output, a drop on a band must go where it used to.
        installBoundaryPatch(slots[0], graph.inputNode, shifted, {
          ignoreRows: () => lgCanvas.linkConnector.state.connectingTo === "input",
          bandColors: () => bandColors,
          drawControls,
          pressControl,
        });
        patched = true;
      }
      const vue = isVue();
      const next = signatureOf(host, slots, rowBySlot, vue);
      if (next !== signature) {
        signature = next;
        rebuild(vue);
      }
      // The signature matched, so slots are in the same order even if undo replaced them.
      lines.forEach((line, i) => {
        line.slot = slots[i];
        line.row = rowBySlot.get(slots[i]) ?? null;
      });
      const lg = window.LiteGraph;
      for (const [name, value] of [
        ["--siv-lg-bg", lg.WIDGET_BGCOLOR],
        ["--siv-lg-outline", lg.WIDGET_OUTLINE_COLOR],
        ["--siv-lg-text", lg.WIDGET_TEXT_COLOR],
        ["--siv-lg-muted", lg.WIDGET_SECONDARY_TEXT_COLOR],
      ]) {
        if (layer.style.getPropertyValue(name) !== value) layer.style.setProperty(name, value);
      }
      controlHeight = vue ? VUE_CONTROL_HEIGHT : CONTROL_HEIGHT;
      layer.classList.toggle("siv-vue", vue);
      layer.classList.toggle("siv-classic", !vue);
      // The tint is the text color, which changes only with the renderer or the palette.
      const palette = `${vue}|${lgCanvas.clear_background_color}|${lg.WIDGET_TEXT_COLOR}|${lg.WIDGET_SECONDARY_TEXT_COLOR}`;
      if (palette !== bandPalette) {
        bandPalette = palette;
        const style = getComputedStyle(layer);
        bandColors = [lgCanvas.clear_background_color, style.getPropertyValue("--siv-value")];
        sourceColor = style.getPropertyValue("--siv-muted");
      }
      layer.hidden = false;
      setShift(graph.inputNode);
      place();
      for (const line of lines) line.control?.refresh();
    },
  };
}
