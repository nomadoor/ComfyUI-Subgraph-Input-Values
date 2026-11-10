// Follows a link back to the primitive node that actually holds the value, so an
// input fed by "Int -> Int -> subgraph" can still be edited from inside. Anything
// that computes its output, a muted or bypassed node, or a link from an outer
// subgraph boundary ends the search.

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

export function findValueSource(graph, linkId) {
  const seen = new Set();
  let link = graph.links.get(linkId);
  while (link) {
    const node = graph.getNodeById(link.origin_id);
    if (!node || seen.has(node.id) || node.mode !== ALWAYS) return null;
    seen.add(node.id);

    if (node.type === "Reroute") {
      link = graph.links.get(node.inputs[0]?.link);
      continue;
    }
    const widget = valueWidget(node);
    if (!widget) return null;
    const input = node.inputs.find((i) => i.widget?.name === widget.name);
    if (input?.link == null) return { node, widget };
    link = graph.links.get(input.link);
  }
  return null;
}
