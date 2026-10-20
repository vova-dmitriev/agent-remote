import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { describe, expect, it } from "vitest"
import { Language } from "@protocol"
import { createLanguageInstance } from "@/shared/lib/i18n"
import { Markdown, MARKDOWN_IDS } from "../index"

function render(text: string) {
  return renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: createLanguageInstance(Language.En) }, createElement(Markdown, { text })),
  )
}

describe("safe Markdown", () => {
  it("renders GFM tables, task lists and highlighted code", () => {
    const html = render("| Name | State |\n| --- | --- |\n| Demo | Ready |\n\n- [x] Done\n\n```js\nconst answer = 42;\n```")

    expect(html).toContain(`<div data-testid="${MARKDOWN_IDS.root}"`)
    expect(html).toContain("<table>")
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('aria-label="Completed task"')
    expect(html).toContain('class="hljs-keyword"')
    expect(html).toContain(`data-testid="${MARKDOWN_IDS.copyCode}"`)
  })

  it("shows raw HTML and XML-like messages as their literal text instead of an empty message", () => {
    const html = render(
      "<heartbeat>\n  <task_id>synthetic-task</task_id>\n  <decision>NOTIFY</decision>\n</heartbeat>\n\nInline <b>tag</b> stays text.",
    )

    expect(html).toContain("&lt;heartbeat&gt;")
    expect(html).toContain("&lt;task_id&gt;synthetic-task&lt;/task_id&gt;")
    expect(html).toContain("Inline &lt;b&gt;tag&lt;/b&gt; stays text.")
    expect(html).not.toMatch(/<(heartbeat|task_id|decision|b)>/)
  })

  it("drops raw HTML and dangerous link protocols", () => {
    const html = render(
      '<script>alert(1)</script>\n\n<img src="https://example.test/track" onerror="alert(1)">\n\n[unsafe](javascript:alert%281%29)\n\n[safe](https://example.test/docs)',
    )

    expect(html).not.toContain("<script")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("javascript:")
    expect(html).toContain('href="https://example.test/docs"')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
  })

  it("turns remote images into explicit links without image requests", () => {
    const html = render("![Synthetic diagram](https://example.test/diagram.png)")

    expect(html).not.toContain("<img")
    expect(html).not.toContain("<link")
    expect(html).toContain('href="https://example.test/diagram.png"')
    expect(html).toContain(`data-testid="${MARKDOWN_IDS.imageLink}"`)
  })

  it("keeps whitespace and unknown-language code readable", () => {
    const html = render("```unknown-demo\n  keep <tag> & text\n\n```\n\n`inline code`")

    expect(html).toContain("  keep &lt;tag&gt; &amp; text\n\n</code>")
    expect(html).toContain("<code>inline code</code>")
    expect(html).toContain('data-language="unknown-demo"')
  })

  it("keeps linked images valid without nested anchors", () => {
    const html = render("[![Preview](https://example.test/image.png)](https://example.test/page)")

    expect(html).toContain('href="https://example.test/image.png"')
    expect(html).not.toContain('href="https://example.test/page"')
    expect(html.match(/<a /g)).toHaveLength(1)
  })

  it.each(["javascript:alert%281%29", "data:image/svg+xml;base64,PHN2Zz4=", "vbscript:example"])("blocks unsafe image URL %s", (url) => {
    const html = render(`![Synthetic image](${url})`)

    expect(html).not.toContain("href=")
    expect(html).not.toContain("src=")
    expect(html).toContain("Synthetic image")
  })
})
