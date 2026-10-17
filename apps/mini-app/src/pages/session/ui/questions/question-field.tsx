import { useId } from "react"
import { QuestionChoiceKind } from "@/pages/session/lib/questions/choice-kind"
import { useTranslation } from "@/shared/lib/hooks"
import { Markdown } from "@/shared/ui/markdown"
import { USER_INPUT_IDS } from "@/pages/session/config/test-ids"
import type { QuestionFieldProps } from "./types"

export function QuestionField({ question, choice, disabled, choose }: QuestionFieldProps) {
  const id = useId()
  const { t } = useTranslation()
  const custom = !question.options || choice?.kind === QuestionChoiceKind.Custom

  return (
    <fieldset className="question-field" data-testid={USER_INPUT_IDS.question} data-question-id={question.id} disabled={disabled}>
      <legend>{question.header || t("userInputTitle")}</legend>
      <Markdown text={question.question} />
      {question.options?.map((option, index) => (
        <label className="question-option" key={option.label}>
          <input
            type="radio"
            name={id}
            data-testid={USER_INPUT_IDS.option}
            data-question-id={question.id}
            data-option-label={option.label}
            checked={choice?.kind === QuestionChoiceKind.Option && choice.value === option.label}
            onChange={() => choose({ kind: QuestionChoiceKind.Option, value: option.label })}
            aria-describedby={option.description ? id + "-description-" + index : undefined}
          />
          <span>
            <strong>{option.label}</strong>
            {option.description ? (
              <span id={id + "-description-" + index} className="question-description">
                {option.description}
              </span>
            ) : null}
          </span>
        </label>
      ))}
      {question.options && question.isOther ? (
        <label className="question-option">
          <input
            type="radio"
            name={id}
            data-testid={USER_INPUT_IDS.other}
            data-question-id={question.id}
            checked={custom}
            onChange={() => choose({ kind: QuestionChoiceKind.Custom, value: "" })}
          />
          {t("userInputOther")}
        </label>
      ) : null}
      {custom ? (
        <label className="question-custom">
          <span>{t("userInputCustom")}</span>
          <input
            className="question-answer"
            type={question.isSecret ? "password" : "text"}
            data-testid={USER_INPUT_IDS.custom}
            data-question-id={question.id}
            value={choice?.kind === QuestionChoiceKind.Custom ? choice.value : ""}
            onChange={(event) => choose({ kind: QuestionChoiceKind.Custom, value: event.target.value })}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={8192}
          />
        </label>
      ) : null}
    </fieldset>
  )
}
