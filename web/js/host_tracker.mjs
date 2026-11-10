// Remembers which SubgraphNode instance the user entered each open subgraph from.
// Only openSubgraph() reports the instance (subgraph-opened carries fromNode); every
// other way in (breadcrumb, URL, undo, tab switch) leaves the level without a host,
// so a stale instance from an earlier visit is never reused.

export function createHostTracker() {
  let path = [];

  return {
    graphChanged(graph, isRoot) {
      if (isRoot) {
        path = [];
        return;
      }
      const index = path.findIndex((entry) => entry.graphId === graph.id);
      if (index >= 0) {
        path = path.slice(0, index + 1);
        return;
      }
      path.push({ graphId: graph.id, hostId: null, hostGraphId: null });
    },

    opened(subgraph, fromNode) {
      const top = path.at(-1);
      if (!top || top.graphId !== subgraph.id || !fromNode) return;
      top.hostId = fromNode.id;
      top.hostGraphId = fromNode.graph.id;
    },

    top() {
      return path.at(-1) ?? null;
    },
  };
}

function isHostOf(node, graph) {
  return !!node && node.isSubgraphNode() && node.subgraph === graph;
}

function graphById(root, id) {
  if (id === root.id) return root;
  return root.subgraphs.get(id) ?? null;
}

function instancesOf(graph) {
  const root = graph.rootGraph;
  const graphs = [root, ...root.subgraphs.values()];
  return graphs.flatMap((g) => g.nodes.filter((node) => isHostOf(node, graph)));
}

// Returns the SubgraphNode whose values the open subgraph should show, or null when
// it cannot be told apart from other instances.
export function resolveHost(entry, graph) {
  if (!entry || entry.graphId !== graph.id) return null;
  if (entry.hostId !== null) {
    const node = graphById(graph.rootGraph, entry.hostGraphId)?.getNodeById(entry.hostId);
    if (isHostOf(node, graph)) return node;
  }
  const instances = instancesOf(graph);
  return instances.length === 1 ? instances[0] : null;
}
