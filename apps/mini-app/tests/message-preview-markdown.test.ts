import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { expect, it } from "vitest"
import { Language } from "@protocol"
import { MarkdownVariant, Markdown } from "@/shared/ui/markdown"
import { createLanguageInstance } from "@/shared/lib/i18n"

function render(text: string) {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: createLanguageInstance(Language.En) },
      createElement(Markdown, { text, variant: MarkdownVariant.Preview }),
    ),
  )
}

it("renders passive rich previews with highlighted code and no focusable controls", () => {
  const html = render(
    "**Ready**\n\n- First\n- Second\n\n```ts\nconst answer = 42;\n```\n\n[Review](https://example.test/pr/1)\n\n![Diagram](https://example.test/image.png)",
  )

  expect(html).toContain("<strong>Ready</strong>")
  expect(html).toContain("<ul>")
  expect(html).toContain("hljs-keyword")
  expect(html).toContain("Diagram")
  expect(html).not.toMatch(/<(button|a|img)\b/)
  expect(html).not.toContain("tabindex")
})

it("keeps HTML and unsafe URLs inert inside a preview", () => {
  const html = render("<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)\n\n**Safe**")

  expect(html).toContain("<strong>Safe</strong>")
  expect(html).not.toContain("<script")
  expect(html).not.toContain("javascript:")
})
