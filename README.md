# ComfyUI Subgraph Input Values

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-red)](README_ja.md)

> [!IMPORTANT]
> The same feature is built into ComfyUI frontend 1.61, and on 1.61 and later this extension does nothing. Inputs can be reordered from the properties panel there (outputs cannot yet).
> If you are not in a hurry, wait until ComfyUI itself ships frontend 1.61.

https://github.com/user-attachments/assets/351969bf-72c4-4cf1-bb5d-f68944cc935d

Edit the values shown on a subgraph node from inside the subgraph.

When you open a subgraph, the same input boxes as on the subgraph node appear next to the input pins along its left edge.

- If several nodes use the same subgraph, you edit the values of the node you opened it from.
- If a Primitive node is connected to the subgraph node outside, you edit that Primitive node's value. Through a chain of Primitives, it goes back to the first one.
- If that Primitive also feeds other nodes, `shared` is shown next to it. Editing the value changes those nodes too.
- If a node that computes its output, such as Get Image Size, is connected outside, the value is not known until the workflow runs, so the input shows `linked` and cannot be edited.
- Drag the ⠿ at the left of a row to change the order of the inputs. The subgraph node outside follows.
- Outputs can be reordered the same way, with the ⠿ at the right end of each output.

## Install

Search for "Subgraph Input Values" in ComfyUI Manager and install it.
