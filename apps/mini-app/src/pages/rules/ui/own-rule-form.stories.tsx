import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { ThemePreference } from "@protocol"
import { RULES_PAGE_IDS } from "../config/test-ids"
import { useOwnRule } from "../model/use-own-rule"
import { OwnRuleForm } from "./own-rule-form"

function OwnRuleStory() {
  const controller = useOwnRule({
    compile: async () => ({ name: "Prod database", patterns: [String.raw`\bpsql\b.*\bprod\b`, String.raw`docker\s+exec\s+prod`] }),
    save: async () => null,
  })

  return <OwnRuleForm controller={controller} />
}

const meta = { component: OwnRuleStory } satisfies Meta<typeof OwnRuleStory>

export default meta
type Story = StoryObj<typeof meta>

export const Closed: Story = {}
export const Describing: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(RULES_PAGE_IDS.add))
    await userEvent.type(canvas.getByTestId(RULES_PAGE_IDS.sentence), "спрашивай перед запросами к prod-базе")
  },
}
export const Drafted: Story = {
  play: async (context) => {
    await Describing.play!(context)
    await userEvent.click(context.canvas.getByTestId(RULES_PAGE_IDS.compile))
    await context.canvas.findByTestId(RULES_PAGE_IDS.patterns)
  },
}
export const DraftedDark: Story = { ...Drafted, globals: { theme: ThemePreference.Dark } }
