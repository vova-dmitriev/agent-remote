import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider } from "react-i18next"
import { expect, it } from "vitest"
import { Language } from "@protocol"
import { QuestionChoiceKind } from "../src/pages/session/lib/questions/choice-kind"
import { createLanguageInstance } from "../src/shared/lib/i18n"
import { AnswerQuestion } from "../src/pages/session/ui/questions/answer-question"
import { QuestionField } from "../src/pages/session/ui/questions/question-field"
import { USER_INPUT_IDS } from "../src/pages/session/config/test-ids"
import { choiceQuestion, freeformQuestion, questionRequest } from "../src/pages/session/ui/questions/fixtures"

it("starts with no selected option and disables explicit Send", () => {
  const html = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: createLanguageInstance(Language.En) },
      createElement(AnswerQuestion, {
        request: questionRequest,
        disabled: false,
        answer: async () => undefined,
      }),
    ),
  )

  expect(html).toContain(`data-request-id="${questionRequest.requestId}"`)
  expect(html).not.toContain("checked=")
  expect(html).toMatch(new RegExp(`data-testid="${USER_INPUT_IDS.submit}"[^>]*disabled=""`))
  expect(html).toContain(`data-testid="${USER_INPUT_IDS.skip}"`)
})

it("masks secret custom answers and safely renders the question Markdown", () => {
  const html = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: createLanguageInstance(Language.En) },
      createElement(QuestionField, {
        question: { ...freeformQuestion, isSecret: true, question: "**Secret** <script>alert('synthetic')</script>" },
        choice: { kind: QuestionChoiceKind.Custom, value: "Synthetic secret" },
        disabled: false,
        choose: () => undefined,
      }),
    ),
  )

  expect(html).toContain('type="password"')
  expect(html).toContain('autoComplete="off"')
  expect(html).toContain("<strong>Secret</strong>")
  expect(html).not.toContain("<script>")
})

it("renders Claude multi-select options as checkboxes", () => {
  const html = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: createLanguageInstance(Language.En) },
      createElement(QuestionField, {
        question: {
          ...choiceQuestion,
          multiSelect: true,
        },
        disabled: false,
        choose: () => undefined,
      }),
    ),
  )

  expect(html).toContain('type="checkbox"')
  expect(html.match(/type="checkbox"/g)).toHaveLength(2)
})
