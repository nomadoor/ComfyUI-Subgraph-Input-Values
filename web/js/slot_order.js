// Moves a subgraph input or output to another place in a serialized workflow. The
// subgraph's slots, the links at its boundary inside, and every instance's slots, saved
// values and links outside are reordered together, as one edit to the workflow.

const INPUT_NODE_ID = -10;
const OUTPUT_NODE_ID = -20;

// Root links are saved as arrays, links inside subgraphs as objects. Floating links,
// left behind by a reroute, keep the end that is still attached.
function links(graph) {
  return [...graph.links, ...(graph.floatingLinks ?? [])];
}

function moveTarget(link, nodeId, map) {
  if (Array.isArray(link)) {
    if (link[3] === nodeId) link[4] = map(link[4]);
  } else if (link.target_id === nodeId) {
    link.target_slot = map(link.target_slot);
  }
}

function moveOrigin(link, nodeId, map) {
  if (Array.isArray(link)) {
    if (link[1] === nodeId) link[2] = map(link[2]);
  } else if (link.origin_id === nodeId) {
    link.origin_slot = map(link.origin_slot);
  }
}

function plan(data, subgraphId, length, from, to) {
  const order = Array.from({ length }, (_, i) => i);
  order.splice(to, 0, ...order.splice(from, 1));
  const place = new Map(order.map((old, i) => [old, i]));
  const graphs = [data, ...data.definitions.subgraphs];
  return {
    order,
    map: (slot) => place.get(slot) ?? slot,
    permute: (list) => order.map((old) => list[old]),
    instances: graphs.flatMap((graph) => graph.nodes.filter((node) => node.type === subgraphId).map((node) => ({ graph, node }))),
  };
}

// Returns false, leaving `data` untouched, when there is nothing to move or an
// instance's saved values cannot be matched to its widget inputs. The frontend leaves
// out `widgets_values` when none is set.
export function moveInput(data, subgraphId, from, to) {
  if (from === to) return false;
  const definition = data.definitions.subgraphs.find((d) => d.id === subgraphId);
  const { order, map, permute, instances } = plan(data, subgraphId, definition.inputs.length, from, to);
  // A promoted value is saved per widget input, in input order.
  const widgetInputs = (node) => node.inputs.flatMap((input, i) => (input.widget ? [i] : []));
  if (instances.some(({ node }) => node.widgets_values && node.widgets_values.length !== widgetInputs(node).length)) return false;

  definition.inputs = permute(definition.inputs);
  for (const link of links(definition)) moveOrigin(link, INPUT_NODE_ID, map);
  for (const { graph, node } of instances) {
    if (node.widgets_values) {
      const values = new Map(widgetInputs(node).map((input, k) => [input, node.widgets_values[k]]));
      node.widgets_values = order.filter((old) => values.has(old)).map((old) => values.get(old));
    }
    node.inputs = permute(node.inputs);
    for (const link of links(graph)) moveTarget(link, node.id, map);
  }
  return true;
}

// Returns false, leaving `data` untouched, when there is nothing to move.
export function moveOutput(data, subgraphId, from, to) {
  if (from === to) return false;
  const definition = data.definitions.subgraphs.find((d) => d.id === subgraphId);
  const { map, permute, instances } = plan(data, subgraphId, definition.outputs.length, from, to);
  definition.outputs = permute(definition.outputs);
  for (const link of links(definition)) moveTarget(link, OUTPUT_NODE_ID, map);
  for (const { graph, node } of instances) {
    node.outputs = permute(node.outputs);
    for (const link of links(graph)) moveOrigin(link, node.id, map);
  }
  return true;
}
