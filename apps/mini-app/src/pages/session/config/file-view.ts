export const FileViewStatus = {
  Loading: "loading",
  Ready: "ready",
  Failed: "failed",
} as const

export type FileViewStatus = (typeof FileViewStatus)[keyof typeof FileViewStatus]

/** Files shown as formatted Markdown; anything else shows as highlighted text. */
export const MARKDOWN_EXTENSIONS: readonly string[] = ["md", "markdown", "mdx"]
