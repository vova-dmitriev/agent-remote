export const MarkdownVariant = {
  Message: "message",
  Preview: "preview",
} as const

export type MarkdownVariant = (typeof MarkdownVariant)[keyof typeof MarkdownVariant]

export const MarkdownNodeType = { Element: "element", Text: "text" } as const

export type MarkdownNodeType = (typeof MarkdownNodeType)[keyof typeof MarkdownNodeType]

/** Markdown syntax tree (mdast) node types, before it becomes HTML. */
export const MarkdownSourceNodeType = {
  Root: "root",
  Blockquote: "blockquote",
  ListItem: "listItem",
  Html: "html",
  Text: "text",
  Paragraph: "paragraph",
} as const

export type MarkdownSourceNodeType = (typeof MarkdownSourceNodeType)[keyof typeof MarkdownSourceNodeType]
