# AGENTS.md

## Project Shape

- ComfyUI frontend extension. Inside a subgraph, each row of the input boundary becomes "label + input": a band from the left-aligned label to the slot, with the value's editor always shown at the right end, as the current renderer (Classic or Nodes 2.0) shows it.
- Python is only the entry point: `__init__.py` exposes `WEB_DIRECTORY`.
- `web/js/main.js` is the only extension entry. Supporting modules use `.mjs` so ComfyUI does not load them as separate extensions.
- No build step and no runtime dependencies.

| Module | Role |
|---|---|
| `host_tracker.mjs` | Which SubgraphNode instance the user entered from |
| `boundary_rows.mjs` | Which widget owns each input's value |
| `value_source.mjs` | Follows an outside link back to the primitive that holds the value |
| `widget_values.mjs` | Number, combo, and control-kind rules |
| `boundary_patch.mjs` | Row geometry; draws the bands, labels and controls, and lets the whole row act as the slot |
| `classic_widgets.mjs` | Draws and operates Classic rows with the frontend's own widget classes |
| `overlay.mjs` | The Nodes 2.0 editors, and the multiline, read-only and source parts in both renderers |

## Rules

- Write values where the frontend keeps them:
  - An unlinked promoted input belongs to the host SubgraphNode (ADR-SUBGRAPH-PROMOTION-0009 in ComfyUI_frontend). Write the host's promoted widget.
  - An input fed from outside belongs to the primitive at the end of the chain. Write that primitive's value widget.
  - Never write the interior widget. Anything that computes its value, or is muted or bypassed, stays read-only.
  - A widget whose options set `disabled` or `read_only` is shown, dimmed, but never written.
- Do not change the subgraph input node's saved data: position, size and serialized state stay as the frontend makes them. Its size is saved, so a different saved size marks the workflow modified and adds undo entries. While the rows are shown, `measure()` makes each row 28 tall and only as wide as its dot, so long labels never move the bracket or pins; the label column grows left instead, between 80 and 160 wide. The boundary's size and its slots' positions are both saved, so the input node's `arrange()` first runs the frontend's own layout, keeps it for `asSerialisable()` of the node and of each slot, then lays out the rows. The frontend places slots from the width the previous arrange left, so each layout runs twice, and so does the first frontend arrange after the rows go away; otherwise a lagging frame gets saved as an undo entry.
- Only drawing and hit testing are extended, and only while the rows are shown: `SubgraphInput.labelPos` draws labels at the row start, and the input node's `containsPoint`, `getSlotInPosition`, `onPointerMove` and `onPointerDown` treat the whole band as the slot, so hovering, dragging a link, renaming and the slot menu still work from the label. A node lying on a band keeps its own clicks and drops, and bands are ignored while a link is dragged from an interior output. Patch from a real input slot; `EmptySubgraphInput` has its own `labelPos`.
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

- `npm test` runs `tests/*.test.mjs` with Node's test runner. Use TDD for the pure modules.
- Check browser behavior against a real ComfyUI with only this extension loaded, in both the classic renderer and Nodes 2.0 (`Comfy.VueNodes.Enabled`):

  ```bash
  venv/bin/python main.py --port 8199 --cpu --disable-all-custom-nodes --whitelist-custom-nodes ComfyUI-Subgraph-Input-Values --user-directory <scratch> --temp-directory <scratch> --output-directory <scratch>
  ```

- Cover at least: two instances entered from each one, Ctrl+Z right after an edit with no click in between, Delete and Escape while a control has focus, an input fed by a chain of primitives, hover, link drag, rename and the slot menu from a label, a node lying on a band, and link drops onto a band from an interior output and input.
- Known limit: a reroute, link segment or group title lying on a band loses presses to the band. Excluding groups by area would switch off every band inside a group.
- The frontend itself logs "Invalid connectingTo state" when a link dragged from the boundary is dropped back on it; that is not this extension.

## Agent State

`AGENTS-STATE.md` is local working memory and is not committed. Read it before starting and update it after each meaningful step.
