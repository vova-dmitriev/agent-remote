import { ReadyRule } from "@protocol"
import { READY_RULE_LABELS, ruleLabel } from "@/entities/rule"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { RULES_PAGE_IDS } from "../config/test-ids"
import type { RulesTabProps } from "./rules-page.types"

const sectionTitle = "text-[13px] font-semibold text-muted-foreground"
const rowClass = "flex items-center gap-[10px] text-[13px]"

/** A project's or a session's rules: ready ones to switch, own ones, inherited ones and always-allowed commands. */
export function RulesTab({ tab, busy, onToggle, onRemove, onForget, children }: RulesTabProps) {
  const { t } = useTranslation()
  const on = new Set(tab.ready)

  return (
    <div className="grid gap-[18px]">
      {tab.bypass ? (
        <p className="border-l-[3px] border-warning py-[2px] pl-[10px] text-[13px]" data-testid={RULES_PAGE_IDS.bypass}>
          {t("rulesSessionBypass")}
        </p>
      ) : null}
      {tab.inherited.length ? (
        <section className="grid gap-[6px]">
          <h2 className={sectionTitle}>{t("rulesFromProject")}</h2>
          {tab.inherited.map((rule) => (
            <p key={rule.id} className={rowClass} data-testid={RULES_PAGE_IDS.inherited} data-rule-id={rule.id}>
              ❗ {ruleLabel(rule, t)}
            </p>
          ))}
        </section>
      ) : null}
      <section className="grid gap-[6px]">
        <h2 className={sectionTitle}>{t("rulesReady")}</h2>
        {Object.values(ReadyRule).map((ready) => (
          <label key={ready} className={rowClass}>
            <input
              type="checkbox"
              className="size-[16px] accent-[var(--primary)]"
              checked={on.has(ready)}
              disabled={busy}
              data-testid={RULES_PAGE_IDS.ready}
              data-ready={ready}
              onChange={(event) => onToggle(ready, event.target.checked)}
            />
            {t(READY_RULE_LABELS[ready])}
          </label>
        ))}
      </section>
      <section className="grid gap-[8px]">
        <h2 className={sectionTitle}>{t("rulesOwn")}</h2>
        {tab.own.map((rule) => (
          <div key={rule.id} className={rowClass} data-testid={RULES_PAGE_IDS.own} data-rule-id={rule.id}>
            <div className="grid min-w-0 flex-1">
              <span>❗ {rule.name}</span>
              <span className="truncate text-[12px] text-muted-foreground">{rule.sentence}</span>
            </div>
            <Button variant="ghost" disabled={busy} data-testid={RULES_PAGE_IDS.delete} onClick={() => onRemove(rule.id)}>
              {t("rulesDelete")}
            </Button>
          </div>
        ))}
        {children}
      </section>
      {tab.allowed.length ? (
        <section className="grid gap-[6px]">
          <h2 className={sectionTitle}>{t("rulesAllowed")}</h2>
          {tab.allowed.map((command) => (
            <div key={command} className={rowClass} data-testid={RULES_PAGE_IDS.allowed} data-command={command}>
              <code className="min-w-0 flex-1 truncate text-[12px]">{command}</code>
              <Button variant="ghost" disabled={busy} data-testid={RULES_PAGE_IDS.forget} onClick={() => onForget(command)}>
                {t("rulesRemove")}
              </Button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}
