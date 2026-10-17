import ReactMarkdown, { type Components, type Options } from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import { MarkdownVariant } from "./constants/values"
import { CodeBlock } from "./code-block"
import { TaskInput } from "./helpers/task-input"
import { MARKDOWN_IDS } from "./test-ids"
import { MarkdownImageLink } from "./markdown-image-link"
import { MarkdownLink } from "./markdown-link"
import { CodePreview } from "./preview/code-preview"
import { LinkPreview } from "./preview/link-preview"
import { ImagePreview } from "./preview/image-preview"
import type { MarkdownProps } from "./markdown.types"

const remarkPlugins = [remarkGfm]
const rehypePlugins: Options["rehypePlugins"] = [[rehypeHighlight, { detect: false }]]
const components: Components = { pre: CodeBlock, a: MarkdownLink, img: MarkdownImageLink, input: TaskInput }
const previewComponents: Components = { pre: CodePreview, a: LinkPreview, img: ImagePreview, input: TaskInput }

export function Markdown({ text, variant = MarkdownVariant.Message }: MarkdownProps) {
  return (
    <div data-testid={MARKDOWN_IDS.root} className="message-markdown">
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
