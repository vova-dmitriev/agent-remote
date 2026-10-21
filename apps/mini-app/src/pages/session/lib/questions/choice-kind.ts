export const QuestionChoiceKind = {
  Option: "option",
  MultipleOptions: "multiple-options",
  Custom: "custom",
} as const

export type QuestionChoiceKind = (typeof QuestionChoiceKind)[keyof typeof QuestionChoiceKind]
