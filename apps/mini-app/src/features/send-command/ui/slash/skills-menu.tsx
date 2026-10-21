import { useTranslation } from "@/shared/lib/hooks"
import { SLASH_SKILL_IDS } from "@/features/send-command/config/slash-test-ids"
import type { SkillsMenuProps } from "./skills-menu.types"
import { SkillsStatus } from "./menu/skills-status"
import { SkillOptions } from "./menu/skill-options"
import { SkillsTruncation } from "./menu/skills-truncation"

export function SkillsMenu({ listId, items, active, loading, failed, supported, truncated, pick, highlight, retry }: SkillsMenuProps) {
  const { t } = useTranslation()

  return (
    <div
      className="absolute inset-x-0 bottom-full z-50 mb-2 max-h-[min(45dvh,320px)] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      data-testid={SLASH_SKILL_IDS.menu}
    >
      <p className="px-3 py-2 text-xs text-muted-foreground">{t("slashSkillsTitle")}</p>
      <SkillsStatus loading={loading} failed={failed} supported={supported} hasItems={items.length > 0} retry={retry} />
      <div id={listId} role="listbox" aria-label={t("slashSkillsTitle")}>
        <SkillOptions items={items} active={active} listId={listId} pick={pick} highlight={highlight} />
      </div>
      <SkillsTruncation truncated={truncated} />
    </div>
  )
}
