import { KeyRound, Settings } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { DropdownItem, DropdownMenu, DropdownTrigger, MenuContent, menuItemClass } from "@/shared/ui/dropdown"
import { SHELL_IDS } from "@/widgets/application-shell/config/test-ids"
import type { SettingsMenuProps } from "./header.types"

/** Header gear menu; app-level destinations that do not belong in the session list. */
export function SettingsMenu({ onAccounts }: SettingsMenuProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu modal={false}>
      <DropdownTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-[28px] text-muted-foreground"
          aria-label={t("settings")}
          title={t("settings")}
          data-testid={SHELL_IDS.settings}
        >
          <Settings aria-hidden="true" size={16} />
        </Button>
      </DropdownTrigger>
      <MenuContent aria-label={t("settings")} data-testid={SHELL_IDS.settingsMenu}>
        <DropdownItem className={menuItemClass} data-testid={SHELL_IDS.accounts} onSelect={onAccounts}>
          <KeyRound aria-hidden="true" size={17} />
          <span>{t("accountsTitle")}</span>
        </DropdownItem>
      </MenuContent>
    </DropdownMenu>
  )
}
