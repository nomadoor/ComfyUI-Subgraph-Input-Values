# ComfyUI Subgraph Input Values

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-red)](README_ja.md)

https://github.com/user-attachments/assets/351969bf-72c4-4cf1-bb5d-f68944cc935d

Edit the values shown on a subgraph node from inside the subgraph.

When you open a subgraph, the same input boxes as on the subgraph node appear next to the input pins along its left edge.

- If several nodes use the same subgraph, you edit the values of the node you opened it from.
- If a Primitive node is connected to the subgraph node outside, you edit that Primitive node's value. Through a chain of Primitives, it goes back to the first one.
- If a node that computes its output, such as Get Image Size, is connected outside, the value is not known until the workflow runs, so the input shows `linked` and cannot be edited.

## Install

Search for "Subgraph Input Values" in ComfyUI Manager and install it.
