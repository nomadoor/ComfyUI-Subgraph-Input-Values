# ComfyUI Subgraph Input Values

[日本語](README_ja.md)

When you open a subgraph, each row of its input boundary becomes a label and an input, like a node's widget row. You can edit the values you promoted to the subgraph node right there. The inputs follow the Classic or Nodes 2.0 style.

- The values belong to the subgraph node you opened.
- Editing changes only that node, the same as editing it from outside. Undo works as usual.
- If an input is fed from outside by an Int, Float, String or Boolean primitive (also through a chain of primitives or a Reroute), you edit that primitive instead. The row shows which node, such as `⇠ Int #5`. Everything else fed by that primitive changes too.
- Inputs fed by anything that computes its value show `linked` and cannot be edited.
- If the subgraph was opened without a specific node (from the breadcrumb or a link) and more than one node uses it, nothing is shown.

This is an experiment. It reads frontend internals that may change.
