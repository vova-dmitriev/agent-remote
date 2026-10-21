import { useState } from "react"
import { ChartColumn, KeyRound, LogOut, Settings, ShieldCheck } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { ConfirmDialog } from "@/shared/ui/confirm-dialog"
import { DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger, MenuContent, menuItemClass } from "@/shared/ui/dropdown"
import { SHELL_IDS } from "@/widgets/application-shell/config/test-ids"
import type { SettingsMenuProps } from "./header.types"

/** Header gear menu: app-level destinations, then, set apart at the bottom, signing out after a confirmation. */
export function SettingsMenu({ onAccounts, onUsage, onRules, onLogout }: SettingsMenuProps) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)

  return (
    <>
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
          {onAccounts ? (
            <DropdownItem className={menuItemClass} data-testid={SHELL_IDS.accounts} onSelect={onAccounts}>
              <KeyRound aria-hidden="true" size={17} />
              <span>{t("accountsTitle")}</span>
            </DropdownItem>
          ) : null}
          {onUsage ? (
            <DropdownItem className={menuItemClass} data-testid={SHELL_IDS.usage} onSelect={onUsage}>
              <ChartColumn aria-hidden="true" size={17} />
              <span>{t("usageTitle")}</span>
            </DropdownItem>
          ) : null}
          {onRules ? (
            <DropdownItem className={menuItemClass} data-testid={SHELL_IDS.rules} onSelect={onRules}>
              <ShieldCheck aria-hidden="true" size={17} />
              <span>{t("rulesTitle")}</span>
            </DropdownItem>
          ) : null}
          {onAccounts || onUsage || onRules ? (
            <DropdownSeparator className="mx-[4px] my-[6px] h-px bg-border" data-testid={SHELL_IDS.settingsSeparator} />
          ) : null}
          <DropdownItem
            className={cn(menuItemClass, "text-danger data-[highlighted]:text-danger")}
            data-testid={SHELL_IDS.logout}
            onSelect={() => setConfirming(true)}
          >
            <LogOut aria-hidden="true" size={17} />
            <span>{t("logout")}</span>
          </DropdownItem>
        </MenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirming}
        title={t("logoutConfirmTitle")}
        description={t("logoutConfirmText")}
        confirmLabel={t("logout")}
        cancelLabel={t("logoutCancel")}
        onConfirm={() => {
          setConfirming(false)
          onLogout()
        }}
        onCancel={() => setConfirming(false)}
        testIds={SHELL_IDS.logoutConfirm}
      />
    </>
  )
}
