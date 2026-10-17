export const QuestionChoiceKind = {
  Option: "option",
  Custom: "custom",
} as const

export type QuestionChoiceKind = (typeof QuestionChoiceKind)[keyof typeof QuestionChoiceKind]
