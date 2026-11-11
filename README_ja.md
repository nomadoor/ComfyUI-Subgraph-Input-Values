# ComfyUI Subgraph Input Values

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-red)](README_ja.md)

https://github.com/user-attachments/assets/351969bf-72c4-4cf1-bb5d-f68944cc935d

サブグラフノードに出している値を、サブグラフの中から編集できます。

サブグラフを開くと、左端に並ぶ入力ピンの横に、外のサブグラフノードと同じ入力欄が出ます。

- 同じサブグラフを複数のノードで使っているときは、開くときに使ったノードの値を編集します。
- 外でサブグラフノードに Primitive ノードをつないでいるときは、その Primitive ノードの値を編集します。Primitive が数珠つなぎになっていても、大元の Primitive までたどります。
- 外で Get Image Size のような、値を計算して出すノードにつないでいるときは、実行するまで値が決まらないので、`linked` と表示されて編集できません。

## インストール

ComfyUI Manager で「Subgraph Input Values」を検索してインストールしてください。
