import type { Meta, StoryObj } from "@storybook/react-vite"
import { QuestionChoiceKind } from "@/pages/session/lib/questions/choice-kind"
import { ThemePreference } from "@protocol"
import { QuestionField } from "./question-field"
import { choiceQuestion, freeformQuestion } from "./fixtures"

const meta = {
  component: QuestionField,
  args: { question: choiceQuestion, disabled: false, choose: () => undefined },
} satisfies Meta<typeof QuestionField>

export default meta
export const Options: StoryObj<typeof meta> = {}
export const Selected: StoryObj<typeof meta> = { args: { choice: { kind: QuestionChoiceKind.Option, value: "Current workspace" } } }
export const Custom: StoryObj<typeof meta> = { args: { choice: { kind: QuestionChoiceKind.Custom, value: "Synthetic alternative" } } }
export const Freeform: StoryObj<typeof meta> = { args: { question: freeformQuestion } }
export const Secret: StoryObj<typeof meta> = {
  args: { question: { ...freeformQuestion, isSecret: true }, choice: { kind: QuestionChoiceKind.Custom, value: "Synthetic secret" } },
}
export const Disabled: StoryObj<typeof meta> = { args: { disabled: true } }
export const Dark: StoryObj<typeof meta> = { globals: { theme: ThemePreference.Dark } }
