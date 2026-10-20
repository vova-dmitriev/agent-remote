import ReactMarkdown, { type Components, type Options } from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import { cn } from "@/shared/lib/utils"
import { MarkdownVariant } from "./constants/values"
import { CodeBlock } from "./code-block"
import { remarkLiteralHtml } from "./helpers/literal-html"
import { TaskInput } from "./helpers/task-input"
import { MARKDOWN_IDS } from "./test-ids"
import { MarkdownImageLink } from "./preview/markdown-image-link"
import { MarkdownLink } from "./preview/markdown-link"
import { CodePreview } from "./preview/code-preview"
import { LinkPreview } from "./preview/link-preview"
import { ImagePreview } from "./preview/image-preview"
import type { MarkdownProps } from "./markdown.types"

// skipHtml stays as a second guard: literal HTML leaves no html nodes to render.
const remarkPlugins = [remarkGfm, remarkLiteralHtml]
const rehypePlugins: Options["rehypePlugins"] = [[rehypeHighlight, { detect: false }]]
const components: Components = { pre: CodeBlock, a: MarkdownLink, img: MarkdownImageLink, input: TaskInput }
const previewComponents: Components = { pre: CodePreview, a: LinkPreview, img: ImagePreview, input: TaskInput }

export function Markdown({ text, variant = MarkdownVariant.Message, className }: MarkdownProps) {
  return (
    <div data-testid={MARKDOWN_IDS.root} className={cn("message-markdown", className)}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={variant === MarkdownVariant.Preview ? previewComponents : components}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
