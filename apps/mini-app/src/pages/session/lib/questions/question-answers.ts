import type { UserInputAnswers, UserInputQuestion } from "@protocol"
import { QuestionChoiceKind } from "./choice-kind"

export type QuestionChoice =
  | { kind: typeof QuestionChoiceKind.Option; value: string }
  | { kind: typeof QuestionChoiceKind.MultipleOptions; value: string[] }
  | { kind: typeof QuestionChoiceKind.Custom; value: string }
export type QuestionChoices = Record<string, QuestionChoice>

export function questionAnswers(questions: UserInputQuestion[], choices: QuestionChoices): UserInputAnswers | null {
  const entries: [string, { answers: string[] }][] = []

  for (const question of questions) {
    const choice = choices[question.id]

    if (!choice) return null

    if (choice.kind === QuestionChoiceKind.MultipleOptions) {
      const values = choice.value

      if (
        !question.multiSelect ||
        !values.length ||
        values.length > 20 ||
        values.some((value) => !value.trim() || value.length > 8192 || !question.options?.some((option) => option.label === value)) ||
        new Set(values).size !== values.length
      ) {
        return null
      }

      entries.push([question.id, { answers: values }])
      continue
    }

    if (!choice.value.trim() || choice.value.length > 8192) return null
    if (
      choice.kind === QuestionChoiceKind.Option &&
      (!question.options?.some((option) => option.label === choice.value) || question.multiSelect)
    )
      return null
    if (choice.kind === QuestionChoiceKind.Custom && question.options && !question.isOther) return null
    entries.push([question.id, { answers: [choice.value] }])
  }

  return Object.fromEntries(entries)
}
