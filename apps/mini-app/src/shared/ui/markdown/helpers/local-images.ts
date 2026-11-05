import { LOCAL_IMAGE_PATH_IN_TEXT, isLocalImagePath } from "@protocol"
import { MarkdownSourceNodeType } from "../constants/values"

interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

const link = (url: string, child: MarkdownNode): MarkdownNode => ({ type: MarkdownSourceNodeType.Link, url, children: [child] })

/** A text node split around the local image paths in it, each path a link. */
function split(node: MarkdownNode): MarkdownNode[] {
  const value = node.value ?? ""
  const parts: MarkdownNode[] = []
  let last = 0

  for (const match of value.matchAll(LOCAL_IMAGE_PATH_IN_TEXT)) {
    if (match.index > last) parts.push({ type: MarkdownSourceNodeType.Text, value: value.slice(last, match.index) })
    parts.push(link(match[0], { type: MarkdownSourceNodeType.Text, value: match[0] }))
    last = match.index + match[0].length
  }

  if (!parts.length) return [node]
  if (last < value.length) parts.push({ type: MarkdownSourceNodeType.Text, value: value.slice(last) })

  return parts
}

function linkPaths(node: MarkdownNode) {
  if (!node.children || node.type === MarkdownSourceNodeType.Link || node.type === MarkdownSourceNodeType.LinkReference) return

  node.children = node.children.flatMap((child) => {
    if (child.type === MarkdownSourceNodeType.InlineCode && isLocalImagePath(child.value ?? "")) return [link(child.value!, child)]

    return child.type === MarkdownSourceNodeType.Text ? split(child) : [child]
  })

  for (const child of node.children) linkPaths(child)
}

/** A local image path the agent wrote becomes a link the app opens from its device; a URL stays as it is. */
export const remarkLocalImages = () => linkPaths
