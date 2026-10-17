import type { Meta, StoryObj } from "@storybook/react-vite"
import { ThemePreference } from "@protocol"
import { MarkdownVariant } from "./constants/values"
import { Markdown } from "./markdown"
import { MARKDOWN_IDS } from "./test-ids"

const text = [
  "# Release checklist",
  "Synthetic content with **emphasis**, ~~old text~~ and `inlineCode()`.",
  "- [x] Render safe Markdown\n- [ ] Review the example",
  "> Quoted text stays readable in either theme.",
  "| Feature | State |\n| --- | --- |\n| Markdown | Ready |\n| Code blocks | Ready |",
  '```ts\nconst greeting: string = "Synthetic example";\nconsole.log(greeting);\n```',
  "[Documentation](https://example.test/docs) and ![Example diagram](https://example.test/diagram.png)",
].join("\n\n")

const meta = { component: Markdown, args: { text } } satisfies Meta<typeof Markdown>

export default meta
type Story = StoryObj<typeof meta>
export const RichText: Story = {}
export const Dark: Story = { globals: { theme: ThemePreference.Dark } }
export const PassivePreview: Story = { args: { variant: MarkdownVariant.Preview } }
export const PlainAndUnknownCode: Story = {
  args: { text: "```\n  keep indentation\n\n  and blank lines\n```\n\n```example-language\n<literal> & unchanged\n```" },
}
export const UntrustedContent: Story = {
  args: {
    text: '<script>alert("example")</script>\n\n[Blocked link](javascript:alert%281%29)\n\n![No automatic image request](https://example.test/image.png)',
  },
}
export const CopyInteraction: Story = {
  play: async ({ canvas }) => {
    await canvas.getByTestId(MARKDOWN_IDS.copyCode).click()
  },
}
