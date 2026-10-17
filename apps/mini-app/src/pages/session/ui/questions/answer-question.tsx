import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { USER_INPUT_IDS } from "@/pages/session/config/test-ids"
import { useAnswerQuestion } from "@/pages/session/model/questions/use-answer-question"
import { QuestionField } from "./question-field"
import type { AnswerQuestionProps } from "./types"

export function AnswerQuestion({ request, disabled, answer }: AnswerQuestionProps) {
  const { t } = useTranslation()
  const model = useAnswerQuestion(request, disabled, answer)

  return (
    <section className="question-card" data-testid={USER_INPUT_IDS.root} data-request-id={request.requestId}>
      <div className="permission-heading">
        <h2 data-testid={USER_INPUT_IDS.title}>{t("userInputTitle")}</h2>
        {request.isBlocking ? <span data-testid={USER_INPUT_IDS.remaining}>{t("seconds", { count: model.remaining })}</span> : null}
      </div>
      <div className="question-fields" data-testid={USER_INPUT_IDS.body}>
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
      <div className="permission-actions">
        <Button
          type="button"
          variant="outline"
          data-testid={USER_INPUT_IDS.skip}
          disabled={model.blocked}
          onClick={() => void model.send(true)}
        >
          {t("userInputSkip")}
        </Button>
        <Button
          type="button"
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
