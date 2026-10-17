import type { ExtraProps } from "react-markdown"
import { MarkdownNodeType } from "@/shared/ui/markdown"
import { PatchLineKind } from "./line-kind"
import { patchKind } from "./patch"

type Element = NonNullable<ExtraProps["node"]>
type Node = Element["children"][number]

function lines(nodes: Node[]): Node[][] {
  const result: Node[][] = [[]]

  for (const node of nodes) {
    const fragments: Node[][] =
      node.type === MarkdownNodeType.Text
        ? node.value.split("\n").map((value) => [{ type: MarkdownNodeType.Text, value }])
        : node.type === MarkdownNodeType.Element
          ? lines(node.children).map((children) => [{ ...node, children }])
          : [[node]]

    fragments.forEach((fragment, index) => {
      if (index) result.push([])
      result.at(-1)!.push(...fragment)
    })
  }

  return result
}

function text(nodes: Node[]): string {
  return nodes
    .map((node) => (node.type === MarkdownNodeType.Text ? node.value : node.type === MarkdownNodeType.Element ? text(node.children) : ""))
    .join("")
}

/** Preserve highlight.js spans while wrapping complete patch lines for accessible +/- styling. */
export function highlightDiffLines() {
  return (tree: unknown) => {
    const visit = (node: { children?: Node[]; tagName?: string }) => {
      if (node.tagName === "code" && node.children) {
        let oldLine = 0
        let newLine = 0

        const rows = lines(node.children)

        if (rows.length > 1 && text(rows.at(-1)!) === "") rows.pop()

        node.children = rows.flatMap((children) => {
          const value = text(children)
          const kind = patchKind(value)
          const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(value)

          if (hunk) {
            oldLine = Number(hunk[1])
            newLine = Number(hunk[2])
          }

          let lineNumber = ""

          if (kind !== PatchLineKind.Hunk && (oldLine || newLine)) {
            lineNumber = String(kind === PatchLineKind.Delete ? oldLine : newLine)
            if (kind !== PatchLineKind.Add) oldLine++
            if (kind !== PatchLineKind.Delete) newLine++
          }

          const line: Element = {
            type: MarkdownNodeType.Element,
            tagName: "span",
            properties: { className: ["diff-line", `diff-line-${kind}`], "data-line": lineNumber },
            children,
          }

          return [line, { type: MarkdownNodeType.Text, value: "\n" }]
        })

        return
      }

      for (const child of node.children ?? []) {
        if (child.type === MarkdownNodeType.Element) visit(child)
      }
    }

    visit(tree as { children?: Node[] })
  }
}
