import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { USER_INPUT_IDS } from "@/pages/session/config/test-ids"
import { useAnswerQuestion } from "@/pages/session/model/questions/use-answer-question"
import { cn } from "@/shared/lib/utils"
import { requestActionClass, requestActionsClass, requestHeadingClass } from "../permission-card/permission-class"
import { QuestionField } from "./question-field"
import type { AnswerQuestionProps } from "./types"

export function AnswerQuestion({ request, disabled, answer }: AnswerQuestionProps) {
  const { t } = useTranslation()
  const model = useAnswerQuestion(request, disabled, answer)

  return (
    <section
      className="my-[6px] flex max-h-[min(calc(50dvh_-_12px),408px)] flex-col rounded-[12px] border border-border bg-surface p-[10px]"
      data-testid={USER_INPUT_IDS.root}
      data-request-id={request.requestId}
    >
      <div className={cn(requestHeadingClass, "flex-none")}>
        <h2 className="text-[14px]" data-testid={USER_INPUT_IDS.title}>
          {t("userInputTitle")}
        </h2>
        {request.isBlocking ? (
          <span className="text-[12px] text-primary" data-testid={USER_INPUT_IDS.remaining}>
            {t("seconds", { count: model.remaining })}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]" data-testid={USER_INPUT_IDS.body}>
        {request.questions.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            choice={model.choices[question.id]}
            disabled={model.blocked}
            choose={(choice) => model.choose(question.id, choice)}
          />
        ))}
      </div>
      <div className={cn(requestActionsClass, "flex-none bg-surface pt-[8px]")}>
        <Button
          type="button"
          variant="outline"
          className={requestActionClass}
          data-testid={USER_INPUT_IDS.skip}
          disabled={model.blocked}
          onClick={() => void model.send(true)}
        >
          {t("userInputSkip")}
        </Button>
        <Button
          type="button"
          className={requestActionClass}
          data-testid={USER_INPUT_IDS.submit}
          disabled={model.blocked || !model.ready}
          onClick={() => void model.send()}
        >
          {t("send")}
        </Button>
      </div>
    </section>
  )
}
