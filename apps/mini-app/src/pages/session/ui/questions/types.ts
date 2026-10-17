import type { PendingUserInput, UserInputAnswers, UserInputQuestion } from "@protocol"
import type { QuestionChoice } from "@/pages/session/lib/questions/question-answers"

export interface AnswerQuestionProps {
  request: PendingUserInput
  disabled: boolean
  answer: (answers: UserInputAnswers) => Promise<void>
}

export interface QuestionFieldProps {
  question: UserInputQuestion
  choice?: QuestionChoice | undefined
  disabled: boolean
  choose: (choice: QuestionChoice) => void
}
