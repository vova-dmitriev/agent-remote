import type { UserInputAnswers, UserInputQuestion } from "@protocol"
import { QuestionChoiceKind } from "./choice-kind"

export type QuestionChoice = { kind: QuestionChoiceKind; value: string }
export type QuestionChoices = Record<string, QuestionChoice>

export function questionAnswers(questions: UserInputQuestion[], choices: QuestionChoices): UserInputAnswers | null {
  const entries: [string, { answers: string[] }][] = []

  for (const question of questions) {
    const choice = choices[question.id]

    if (!choice?.value.trim() || choice.value.length > 8192) return null
    if (choice.kind === QuestionChoiceKind.Option && !question.options?.some((option) => option.label === choice.value)) return null
    if (choice.kind === QuestionChoiceKind.Custom && question.options && !question.isOther) return null
    entries.push([question.id, { answers: [choice.value] }])
  }

  return Object.fromEntries(entries)
}
