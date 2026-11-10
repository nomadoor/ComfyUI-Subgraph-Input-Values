import { app } from "../../../scripts/app.js";
import { createHostTracker, resolveHost } from "./host_tracker.mjs";
import { createBoundaryOverlay } from "./overlay.mjs";

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("../css/boundary_values.css", import.meta.url).href;
document.head.append(stylesheet);

app.registerExtension({
  name: "nomadoor.SubgraphInputValues",

  setup() {
    const canvas = app.canvas;
    const tracker = createHostTracker();
    // Edits made on the layer happen after the change tracker's own mouseup and
    // keyup captures, so record them explicitly, as the frontend's Vue widgets do.
    const overlay = createBoundaryOverlay(canvas, {
      isVue: () => app.extensionManager.setting.get("Comfy.VueNodes.Enabled"),
      onCommit: () => app.extensionManager.workflow.activeWorkflow?.changeTracker.captureCanvasState(),
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
