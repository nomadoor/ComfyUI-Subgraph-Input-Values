# AGENTS.md

## Project Shape

- ComfyUI frontend extension. Inside a subgraph, each row of the input boundary becomes "label + input": a band from the left-aligned label to the slot, with the value's editor always shown at the right end, as the current renderer (Classic or Nodes 2.0) shows it.
- Frontend 1.61 and later show the values on the boundary themselves (`SubgraphIoPanel`), and their boundary's `arrange()` no longer resets its size, so the rows here would grow it every frame and that size would be saved. On those versions `setup()` returns before adding anything; the stylesheet is added in `setup()`, after that check. The check reads `window.__COMFYUI_FRONTEND_VERSION__` (set after modules load, so only in `setup()`), and without a version it checks for `SubgraphIONodeBase.prototype.fitSize`, which came with that `arrange()`.
- Python is only the entry point: `__init__.py` exposes `WEB_DIRECTORY`.
- Browser modules under `web/` are plain `.js`. ComfyUI serves `.js` with `Cache-Control: no-store`; any other extension (`.mjs` included) gets no cache header, so the browser keeps its own copy and goes on running the old file after an update, through a ComfyUI restart and a hard reload. Do not add `.mjs` files under `web/`.
- ComfyUI imports every `.js` under `web/` once at startup (the `/extensions` list). `web/js/main.js` is the only file that calls `app.registerExtension`. Every other module only defines and exports: no code that runs on import, no import cycles. The startup import and `main.js`'s own imports load the same URL, so each module still runs once.
- Import specifiers are plain relative paths with no query string; a query makes a second copy of the module.
- Code that must load only on demand goes in a dot-directory such as `web/js/.lazy/`: ComfyUI serves it with `no-store` but does not list it.
- No build step and no runtime dependencies.

| Module | Role |
|---|---|
| `host_tracker.js` | Which SubgraphNode instance the user entered from |
| `boundary_rows.js` | Which widget owns each input's value |
| `value_source.js` | Follows an outside link back to the primitive that holds the value |
| `slot_order.js` | Moves a subgraph input or output in the serialized workflow |
| `widget_values.js` | Number, combo, and control-kind rules |
| `boundary_patch.js` | Row geometry; draws the bands, grips, labels and controls on the input boundary and bands and grips on the output boundary, lets the whole row act as the slot, and drags rows by their grips |
| `classic_widgets.js` | Draws and operates Classic rows with the frontend's own widget classes |
| `overlay.js` | The Nodes 2.0 editors, and the multiline, read-only and source parts in both renderers |

## Rules

- Write values where the frontend keeps them:
  - An unlinked promoted input belongs to the host SubgraphNode (ADR-SUBGRAPH-PROMOTION-0009 in ComfyUI_frontend). Write the host's promoted widget.
  - An input fed from outside belongs to the primitive at the end of the chain. Write that primitive's value widget.
  - Never write the interior widget. Anything that computes its value, or is muted or bypassed, stays read-only, and the row names the node it stopped at.
  - When a node on the way to the primitive also feeds something else, the row's source tag says `shared`: editing it changes those too.
  - A widget whose options set `disabled` or `read_only` is shown, dimmed, but never written.
- Do not change the subgraph input node's saved data: position, size and serialized state stay as the frontend makes them. Its size is saved, so a different saved size marks the workflow modified and adds undo entries. While the rows are shown, `measure()` makes each row 28 tall and only as wide as its dot, so long labels never move the bracket or pins; the label column grows left instead, between 80 and 160 wide. The boundary's size and its slots' positions are both saved, so the input node's `arrange()` first runs the frontend's own layout, keeps it for `asSerialisable()` of the node and of each slot, then lays out the rows. The frontend places slots from the width the previous arrange left, so each layout runs twice, and so does the first frontend arrange after the rows go away; otherwise a lagging frame gets saved as an undo entry.
- Each band starts with a grip; over it the cursor is a hand (the canvas's `_setCursor` is wrapped). Dragging it moves the row among the others (laid out in `arrange()`, after the saved layout is kept); Escape puts it back. The subgraph node outside always shows inputs without a widget first and those with one after them, whatever their order in the data. The rows are shown in the same two groups with a gap between them (display only: the saved layout is the frontend's), and a row moves only within its group, so the order inside and outside agree. Dropping it at another place moves the input with `moveInput()` (an output with `moveOutput()`) on the serialized workflow, for the subgraph and every instance (inputs, saved values, links on both sides), and loads the result through the change tracker's `redo()`, as undo loads a state. The move is then one undo step and the view stays in the subgraph. Do not reorder the live graph: links and promoted widget values live in frontend stores that an extension cannot update together. Grips exist only while rows are shown, so a subgraph with no widget inputs, or one whose instance cannot be told apart, cannot be reordered from here.
- The output boundary gets bands whenever a subgraph with outputs is open, whether or not input rows are shown: the input rows mirrored, `ROW_HEIGHT` apart with bands as tall, from each pin to past its label (at least 150 wide) and ending in the grip. The pins stay where the frontend puts them, and the saved layout is the frontend's, as on the input side. Pins, labels, hover, drops and the cursor work as on the input side.
- Only drawing and hit testing are extended, and only while the rows are shown: `SubgraphInput.labelPos` draws labels at the row start, and the input node's `containsPoint`, `getSlotInPosition`, `onPointerMove` and `onPointerDown` treat the whole band as the slot for hovering, link drops and the slot menu. A link is dragged only from the pin: the control sits between the label and the pin, so a label that also dragged links was easy to grab by mistake. A left press on the label takes the drag and does nothing with it (otherwise the canvas moves the boundary), and a double-click renames; the cursor there is the plain arrow. A node lying on a band keeps its own clicks and drops, and bands are ignored while a link is dragged from an interior output. Patch from a real input slot; `EmptySubgraphInput` has its own `labelPos`.
- The input node draws the bands on the canvas before itself: opaque (the canvas color tinted toward the text color), so the grid does not show through and labels and pins stay on top. Nodes 2.0 colors come from the raw design tokens (`--foreground`, `--input`, ...); Tailwind inlines `--color-*`, so those are not defined at runtime.
- Reuse the frontend's UI rather than imitating it:
  - Classic number, combo, toggle and text rows are the frontend's widget classes, drawn on the band with `drawWidget` and operated through `onClick`/`onDrag`, so the arrows, dragging, the value prompt and the combo menu are the frontend's own. The classes are not exported; `addWidget` on a throwaway `LGraphNode` yields each one. A promoted widget is a plain descriptor, which is wrapped per draw and press as the canvas does. A press measures against the node's width, so it is moved there (`widgetPointerX`). A click selects the boundary, as a click on a slot does; a drag never moves it.
  - Nodes 2.0 components are not reachable from an extension, so its controls are built from the same Tailwind classes as `WidgetInputNumberInput`/`ScrubableNumberInput`, `WidgetSelectDefault`, `WidgetToggleSwitch` and `WidgetInputText` in 1.58.5, at the h-6 widget height. The combo menu is appended to `body` like the reka portal.
- Only the HTML controls take pointer events. Buttons never take focus, so Space and Delete keep reaching the canvas.
- A field writes only what the user typed since it got focus. One-line fields block the browser's own text undo: Ctrl+Z on the canvas would otherwise refocus an earlier field, restore its old text, and write it back on blur. The multiline editor keeps text undo, and closing it writes what was typed.
- The entered-from instance comes only from the `subgraph-opened` event (`detail.fromNode`). Any other way in leaves the level without a recorded instance; then show values only when the subgraph has exactly one instance. Never guess between several instances.
- After each edit, call `captureCanvasState()`. Edits on the layer happen after the change tracker's own captures.
- Keep the pure modules free of DOM and ComfyUI imports.
- No network access, no `eval`, no new dependencies without asking.

## Testing

- `npm test` runs `tests/*.test.mjs` with Node's test runner. Use TDD for the pure modules. `tests/modules.test.mjs` checks the module rules above.
- Check browser behavior against a real ComfyUI with only this extension loaded, in both the classic renderer and Nodes 2.0 (`Comfy.VueNodes.Enabled`):

  ```bash
  venv/bin/python main.py --port 8199 --cpu --disable-all-custom-nodes --whitelist-custom-nodes ComfyUI-Subgraph-Input-Values --user-directory <scratch> --temp-directory <scratch> --output-directory <scratch>
  ```

- Cover at least: dragging an output's grip with two instances (links outside, the prompt, Ctrl+Z), dragging a grip in both directions with two instances (values, links on both sides, the prompt, Ctrl+Z, reload), Escape during a drag, a click on a grip, the shared mark, a linked row's source, two instances entered from each one, Ctrl+Z right after an edit with no click in between, Delete and Escape while a control has focus, an input fed by a chain of primitives, hover, rename and the slot menu from a label, no link drag and no boundary move from a label, a node lying on a band, and link drops onto a band from an interior output and input.
- Known limit: a reroute, link segment or group title lying on a band loses presses to the band. Excluding groups by area would switch off every band inside a group.
- The frontend itself logs "Invalid connectingTo state" when a link dragged from the boundary is dropped back on it; that is not this extension.

## Agent State

`AGENTS-STATE.md` is local working memory and is not committed. Read it before starting and update it after each meaningful step.
