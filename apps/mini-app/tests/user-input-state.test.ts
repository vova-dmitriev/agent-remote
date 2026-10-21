import { describe, expect, it } from "vitest"
import type { UserInputQuestion } from "@protocol"
import { QuestionChoiceKind } from "../src/pages/session/lib/questions/choice-kind"
import { questionAnswers } from "../src/pages/session/lib/questions/question-answers"

const questions: UserInputQuestion[] = [
  {
    id: "scope",
    header: "Scope",
    question: "Choose scope",
    isOther: true,
    isSecret: false,
    options: [{ label: "Local", description: "This workspace" }],
  },
  { id: "token", header: "Token", question: "Enter token", isOther: false, isSecret: true, options: null },
]

describe("questionAnswers", () => {
  it("requires an explicit answer to every question", () => {
    expect(questionAnswers(questions, {})).toBeNull()
    expect(questionAnswers(questions, { scope: { kind: QuestionChoiceKind.Option, value: "Local" } })).toBeNull()
  })

  it("preserves the exact selected label and custom text", () => {
    expect(
      questionAnswers(questions, {
        scope: { kind: QuestionChoiceKind.Option, value: "Local" },
        token: { kind: QuestionChoiceKind.Custom, value: " secret " },
      }),
    ).toEqual({
      scope: { answers: ["Local"] },
      token: { answers: [" secret "] },
    })
  })

  it("allows custom answers only for freeform or other-enabled questions", () => {
    expect(questionAnswers([questions[0]!], { scope: { kind: QuestionChoiceKind.Custom, value: "Different" } })).toEqual({
      scope: { answers: ["Different"] },
    })

    expect(
      questionAnswers([{ ...questions[0]!, isOther: false }], { scope: { kind: QuestionChoiceKind.Custom, value: "Different" } }),
    ).toBeNull()
  })

  it("rejects missing options, whitespace, oversized answers and stale question ids", () => {
    for (const value of ["Elsewhere", "", " ", "x".repeat(8193)]) {
      expect(questionAnswers([questions[0]!], { scope: { kind: QuestionChoiceKind.Option, value } })).toBeNull()
    }

    expect(questionAnswers([questions[1]!], { token: { kind: QuestionChoiceKind.Custom, value: " " } })).toBeNull()
    expect(questionAnswers([questions[1]!], { stale: { kind: QuestionChoiceKind.Custom, value: "answer" } })).toBeNull()
  })

  it("keeps Claude multi-select choices as separate validated labels", () => {
    const multiSelect: UserInputQuestion = {
      id: "tools",
      header: "Tools",
      question: "Which tools should be enabled?",
      isOther: false,
      isSecret: false,
      multiSelect: true,
      options: [
        { label: "Read", description: "Inspect files" },
        { label: "Write", description: "Edit files" },
      ],
    }

    expect(
      questionAnswers([multiSelect], {
        tools: { kind: QuestionChoiceKind.MultipleOptions, value: ["Read", "Write"] },
      }),
    ).toEqual({ tools: { answers: ["Read", "Write"] } })

    expect(
      questionAnswers([multiSelect], {
        tools: { kind: QuestionChoiceKind.MultipleOptions, value: ["Read", "Unknown"] },
      }),
    ).toBeNull()
  })
})
