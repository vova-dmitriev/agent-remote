export const MarkdownVariant = {
  Message: "message",
  Preview: "preview",
} as const

export type MarkdownVariant = (typeof MarkdownVariant)[keyof typeof MarkdownVariant]

export const MarkdownNodeType = { Element: "element", Text: "text" } as const

export type MarkdownNodeType = (typeof MarkdownNodeType)[keyof typeof MarkdownNodeType]
