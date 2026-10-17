import type { ExtraProps } from "react-markdown"
import { MarkdownNodeType } from "../constants/values"

type Node = NonNullable<ExtraProps["node"]>["children"][number]

function textContent(node: Node): string {
  if (node.type === MarkdownNodeType.Text) return node.value

  return "children" in node ? node.children.map(textContent).join("") : ""
}

export function codeContent(node: ExtraProps["node"]) {
  const code = node?.children.find((child) => child.type === MarkdownNodeType.Element && child.tagName === "code")
  const classes = code?.type === MarkdownNodeType.Element ? code.properties.className : undefined
  const languageClass = Array.isArray(classes) ? classes.find((value) => String(value).startsWith("language-")) : undefined

  return {
    text: code ? textContent(code) : "",
    language: languageClass ? String(languageClass).slice("language-".length) : "",
  }
}
