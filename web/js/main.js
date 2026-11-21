import { app } from "../../../scripts/app.js";
import { createHostTracker, resolveHost } from "./host_tracker.js";
import { moveInput, moveOutput } from "./slot_order.js";
import { createBoundaryOverlay } from "./overlay.js";

// Frontend 1.61 shows these values itself, and its boundary keeps its size across arranges,
// so the rows would grow it every frame. Without a version, fitSize (new in 1.61) marks it.
function hasNativeValues() {
  const [major, minor] = String(window.__COMFYUI_FRONTEND_VERSION__ ?? "").split(".").map(Number);
  if (major > 1 || (major === 1 && minor >= 61)) return true;
  if (major === 1) return false;
  return "fitSize" in window.LiteGraph.Classes.SubgraphIONodeBase.prototype;
}

// Moves a slot in the saved workflow and loads the result through the change tracker's
// own redo, as undo loads a state: the move becomes one undo step and the view stays
// where it is.
async function moveSlot(move, subgraphId, from, to) {
  const changeTracker = app.extensionManager.workflow.activeWorkflow?.changeTracker;
  if (!changeTracker) return;
  changeTracker.captureCanvasState();
  // Copied as the change tracker copies its states.
  const data = JSON.parse(JSON.stringify(app.rootGraph.serialize()));
  if (!move(data, subgraphId, from, to)) {
    console.warn("[Subgraph Input Values] Could not move the slot: an instance's saved values do not match its slots.");
    return;
  }
  // If the load fails, redo puts the state back; it must not be redone later.
  const { redoQueue } = changeTracker;
  redoQueue.splice(0, redoQueue.length, data);
  await changeTracker.redo();
  if (redoQueue.includes(data)) redoQueue.splice(redoQueue.indexOf(data), 1);
}

app.registerExtension({
  name: "nomadoor.SubgraphInputValues",

  setup() {
    if (hasNativeValues()) {
      console.info("[Subgraph Input Values] This frontend shows subgraph input values itself, so the extension stays off.");
      return;
    }
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL("../css/boundary_values.css", import.meta.url).href;
    document.head.append(stylesheet);

    const canvas = app.canvas;
    const tracker = createHostTracker();
    // Edits made on the layer happen after the change tracker's own mouseup and
    // keyup captures, so record them explicitly, as the frontend's Vue widgets do.
    const overlay = createBoundaryOverlay(canvas, {
      isVue: () => app.extensionManager.setting.get("Comfy.VueNodes.Enabled"),
      onCommit: () => app.extensionManager.workflow.activeWorkflow?.changeTracker.captureCanvasState(),
      onMoveInput: (subgraphId, from, to) => moveSlot(moveInput, subgraphId, from, to),
      onMoveOutput: (subgraphId, from, to) => moveSlot(moveOutput, subgraphId, from, to),
    });

    const sync = () => {
      const graph = canvas.graph;
      if (graph && graph !== graph.rootGraph) {
        if (tracker.top()?.graphId !== graph.id) tracker.graphChanged(graph, false);
        overlay.update(graph, resolveHost(tracker.top(), graph));
      } else {
        overlay.update(graph, null);
      }
    };
    // Rows are laid out before the new level's first draw, once setGraph and the
    // subgraph-opened that may follow it have finished.
    canvas.canvas.addEventListener("litegraph:set-graph", (e) => {
      const graph = e.detail.newGraph;
      tracker.graphChanged(graph, graph === graph.rootGraph);
      queueMicrotask(sync);
    });
    canvas.canvas.addEventListener("subgraph-opened", (e) => {
      tracker.opened(e.detail.subgraph, e.detail.fromNode);
    });

    const frame = () => {
      requestAnimationFrame(frame);
      sync();
    };
    requestAnimationFrame(frame);
  },
});
