import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { RULES_PAGE_IDS } from "../config/test-ids"
import type { OwnRuleFormProps } from "./rules-page.types"

const fieldClass = "w-full rounded-[8px] border border-border bg-surface px-[10px] py-[8px] text-[13px] text-foreground"

/** "Own rule…": the owner's words, then the drafted name and patterns to confirm or edit. */
export function OwnRuleForm({ controller }: OwnRuleFormProps) {
  const { t } = useTranslation()

  if (!controller.open)
    return (
      <Button variant="outline" className="justify-self-start" data-testid={RULES_PAGE_IDS.add} onClick={controller.start}>
        {t("rulesAdd")}
      </Button>
    )

  return (
    <div className="grid gap-[8px] rounded-[12px] border border-border p-[12px]">
      <textarea
        className={fieldClass}
        rows={2}
        placeholder={t("rulesSentence")}
        aria-label={t("rulesSentence")}
        value={controller.sentence}
        data-testid={RULES_PAGE_IDS.sentence}
        onChange={(event) => controller.setSentence(event.target.value)}
      />
      {controller.drafted ? (
        <>
          <input
            className={fieldClass}
            aria-label={t("rulesName")}
            value={controller.name}
            data-testid={RULES_PAGE_IDS.name}
            onChange={(event) => controller.setName(event.target.value)}
          />
          <textarea
            className={fieldClass + " font-mono text-[12px]"}
            rows={4}
            aria-label={t("rulesPatterns")}
            title={t("rulesPatterns")}
            value={controller.patterns}
            data-testid={RULES_PAGE_IDS.patterns}
            onChange={(event) => controller.setPatterns(event.target.value)}
          />
        </>
      ) : null}
      {controller.error ? <p className="text-[12px] text-danger">{feedbackText(controller.error, t)}</p> : null}
      <div className="flex flex-wrap gap-[8px]">
        {controller.drafted ? (
          <Button
            data-testid={RULES_PAGE_IDS.save}
            disabled={controller.busy || !controller.name.trim()}
            onClick={() => void controller.save()}
          >
            {t("rulesSave")}
          </Button>
        ) : (
          <Button
            data-testid={RULES_PAGE_IDS.compile}
            disabled={controller.busy || !controller.sentence.trim()}
            onClick={() => void controller.compile()}
          >
            {t("rulesCompile")}
          </Button>
        )}
        <Button variant="ghost" data-testid={RULES_PAGE_IDS.cancel} onClick={controller.cancel}>
          {t("rulesCancel")}
        </Button>
      </div>
    </div>
  )
}
