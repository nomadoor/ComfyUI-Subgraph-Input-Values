// Pairs each subgraph input slot with the widget that owns its value: the host's
// promoted widget, or, when that input is fed by a primitive outside, the primitive.
// `source` is the primitive outside whose value the row edits. A read-only linked row
// has `stoppedAt` instead: the node the value could not be traced past, if any.

import { findValueSource } from "./value_source.mjs";

function hostInputFor(host, slot) {
  return host.inputs.find(
    (input) => input._subgraphSlot === slot || input._subgraphSlot?.id === slot.id
  );
}

// Promoted multiline text is a DOM widget with no widgetId, so the widget is found
// through the slot, the way the frontend itself does.
export function buildRows(host, subgraph) {
  const rows = [];
  for (const slot of subgraph.inputs) {
    const input = hostInputFor(host, slot);
    if (!input?.widgetId) continue;
    const widget = host.getWidgetFromSlot(input);
    if (!widget) continue;
    if (input.link == null) {
      rows.push({ slot, widget, kind: "value" });
      continue;
    }
    const source = findValueSource(host.graph, input.link);
    rows.push(
      source?.widget
        ? { slot, widget: source.widget, source: source.node, shared: source.shared, kind: "source" }
        : { slot, widget, stoppedAt: source?.node, kind: "linked" }
    );
  }
  return rows;
}
