import type { Meta, StoryObj } from "@storybook/react-vite"
import { userEvent } from "storybook/test"
import { Language, ThemePreference } from "@protocol"
import { USER_INPUT_IDS } from "@/pages/session/config/test-ids"
import { AnswerQuestion } from "./answer-question"
import { choiceQuestion, freeformQuestion, questionRequest } from "./fixtures"

const meta = {
  component: AnswerQuestion,
  args: { request: questionRequest, disabled: false, answer: async () => undefined },
} satisfies Meta<typeof AnswerQuestion>

export default meta
type Story = StoryObj<typeof meta>

export const Unselected: Story = {}
export const Selected: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getAllByTestId(USER_INPUT_IDS.option)[0]!)
  },
}
export const OtherAnswer: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId(USER_INPUT_IDS.other))
    await userEvent.type(canvas.getByTestId(USER_INPUT_IDS.custom), "Synthetic alternative")
  },
}
export const MultipleQuestions: Story = {
  args: { request: { ...questionRequest, questions: [choiceQuestion, freeformQuestion] } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getAllByTestId(USER_INPUT_IDS.option)[1]!)
    await userEvent.type(canvas.getByTestId(USER_INPUT_IDS.custom), "Synthetic project")
  },
}
export const Freeform: Story = { args: { request: { ...questionRequest, questions: [freeformQuestion] } } }
export const Secret: Story = {
  args: { request: { ...questionRequest, questions: [{ ...freeformQuestion, isSecret: true }] } },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByTestId(USER_INPUT_IDS.custom), "Synthetic masked answer")
  },
}
export const Disabled: Story = { args: { disabled: true } }
export const Expired: Story = { args: { request: { ...questionRequest, expiresAt: 1 } } }
export const English: Story = { globals: { language: Language.En } }
export const Dark: Story = { ...MultipleQuestions, globals: { theme: ThemePreference.Dark } }
