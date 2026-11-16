// Follows a link back to the primitive node that actually holds the value, so an
// input fed by "Int -> Int -> subgraph" can still be edited from inside. Anything
// that computes its output, or a muted or bypassed node, ends the search there:
// the result names that node but has no widget. A link from an outer subgraph
// boundary, a missing node or a loop gives null.

const ALWAYS = 0;

const PRIMITIVES = new Set([
  "PrimitiveInt",
  "PrimitiveFloat",
  "PrimitiveString",
  "PrimitiveStringMultiline",
  "PrimitiveBoolean",
]);

function valueWidget(node) {
  if (PRIMITIVES.has(node.type)) return node.widgets.find((w) => w.name === "value") ?? null;
  if (node.type === "PrimitiveNode") return node.widgets[0] ?? null;
  return null;
}

// `shared` is true when a node on the way also feeds something else, so editing the
// value changes more than this input.
export function findValueSource(graph, linkId) {
  const seen = new Set();
  let shared = false;
  let link = graph.links.get(linkId);
  while (link) {
    const node = graph.getNodeById(link.origin_id);
    if (!node || seen.has(node.id)) return null;
    seen.add(node.id);
    if (node.mode !== ALWAYS) return { node };
    shared ||= node.outputs?.[link.origin_slot]?.links?.length > 1;

    if (node.type === "Reroute") {
      link = graph.links.get(node.inputs[0]?.link);
      continue;
    }
    const widget = valueWidget(node);
    if (!widget) return { node };
    const input = node.inputs.find((i) => i.widget?.name === widget.name);
    if (input?.link == null) return { node, widget, shared };
    link = graph.links.get(input.link);
  }
  return null;
}
