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
    <fieldset
      className="my-[12px] min-w-0 border-0 p-0 disabled:opacity-60"
      data-testid={USER_INPUT_IDS.question}
      data-question-id={question.id}
      disabled={disabled}
    >
      <legend className="text-[12px] text-muted-foreground">{question.header || t("userInputTitle")}</legend>
      <Markdown className="mt-[5px] mb-[8px] text-[14px]" text={question.question} />
      {question.options?.map((option, index) => (
        <label className={optionClass} key={option.label}>
          <input
            type={question.multiSelect ? "checkbox" : "radio"}
            className={radioClass}
            name={id}
            data-testid={USER_INPUT_IDS.option}
            data-question-id={question.id}
            data-option-label={option.label}
            checked={
              question.multiSelect
                ? choice?.kind === QuestionChoiceKind.MultipleOptions && choice.value.includes(option.label)
                : choice?.kind === QuestionChoiceKind.Option && choice.value === option.label
            }
            onChange={() => {
              if (!question.multiSelect) {
                choose({ kind: QuestionChoiceKind.Option, value: option.label })

                return
              }

              const selected = choice?.kind === QuestionChoiceKind.MultipleOptions ? choice.value : []

              const next = selected.includes(option.label)
                ? selected.filter((label) => label !== option.label)
                : [...selected, option.label]

              choose({ kind: QuestionChoiceKind.MultipleOptions, value: next })
            }}
            aria-describedby={option.description ? id + "-description-" + index : undefined}
          />
          <span>
            <strong>{option.label}</strong>
            {option.description ? (
              <span id={id + "-description-" + index} className="block text-[12px] text-muted-foreground">
                {option.description}
              </span>
            ) : null}
          </span>
        </label>
      ))}
      {question.options && question.isOther ? (
        <label className={optionClass}>
          <input
            type="radio"
            className={radioClass}
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
        <label className="grid gap-[5px] text-[12px]">
          <span>{t("userInputCustom")}</span>
          <input
            className="w-full rounded-[8px] border border-border bg-background px-[10px] py-[8px] text-[16px] text-foreground"
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

const optionClass = "flex cursor-pointer items-start gap-[9px] py-[7px] text-[14px]"

const radioClass = "mt-[2px] size-[17px] flex-none p-0 accent-primary"
