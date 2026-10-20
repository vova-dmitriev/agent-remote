import { MarkdownSourceNodeType } from "../constants/values"

interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
}

/** Parents whose children are blocks: literal HTML there becomes its own paragraph. */
const BLOCK_PARENTS = new Set<string>([MarkdownSourceNodeType.Root, MarkdownSourceNodeType.Blockquote, MarkdownSourceNodeType.ListItem])

function literal(node: MarkdownNode) {
  for (const [index, child] of (node.children ?? []).entries()) {
    if (child.type === MarkdownSourceNodeType.Html) {
      const text = { type: MarkdownSourceNodeType.Text, value: child.value ?? "" }

      node.children![index] = BLOCK_PARENTS.has(node.type) ? { type: MarkdownSourceNodeType.Paragraph, children: [text] } : text
    } else {
      literal(child)
    }
  }
}

/**
 * Raw HTML in a message is shown as the literal text it is, never rendered: XML-like agent messages (automation
 * heartbeats, tool envelopes) would otherwise vanish and leave an empty message.
 */
export const remarkLiteralHtml = () => literal
