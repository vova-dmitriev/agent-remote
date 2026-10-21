import { ConnectionStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { LanguageSwitcher } from "@/shared/ui/language-switcher"
import { ThemeSwitcher } from "@/shared/ui/theme-switcher"
import { Button } from "@/shared/ui/button"
import { useHost } from "@/shared/lib/host"
import { cn } from "@/shared/lib/utils"
import { SHELL_IDS } from "@/widgets/application-shell/config/test-ids"
import { SettingsMenu } from "./settings-menu"
import type { ShellHeaderProps } from "./header.types"

/** App bar: brand, connection, language, theme, sign out and the settings menu. */
export function ShellHeader({ connection, onHome, onLogout, onAccounts, onUsage, leading, className }: ShellHeaderProps) {
  const { t } = useTranslation()
  const host = useHost()
  const online = connection === ConnectionStatus.Online

  return (
    <header className={cn("flex items-center justify-between gap-[10px]", className)} data-testid={SHELL_IDS.header}>
      {leading}
      <Button
        variant="link"
        className="h-auto p-0 font-display text-[17px] font-extrabold tracking-[-1px] text-foreground no-underline hover:no-underline phone:text-[15px]"
        data-testid={SHELL_IDS.home}
        onClick={onHome}
      >
        {t("brandName")} <span className="font-normal text-primary">{t("brandSuffix")}</span>
      </Button>
      <span className={cn(connectionClass, online && "before:bg-status-ready")} data-testid={SHELL_IDS.connection}>
        {t(online ? ConnectionStatus.Online : connection === ConnectionStatus.Expired ? "loginRequired" : ConnectionStatus.Offline)}
      </span>
      <div className="flex items-center gap-[8px] phone:gap-[3px] tiny:ml-auto">
        {host.capabilities.fullTab ? (
          <Button variant="link" className={actionClass} data-testid={SHELL_IDS.openTab} onClick={() => void host.openFullTab?.()}>
            {t("extensionOpenFullTab")}
          </Button>
        ) : null}
        <LanguageSwitcher />
        <ThemeSwitcher />
        <Button variant="link" className={cn(actionClass, "text-muted-foreground")} data-testid={SHELL_IDS.logout} onClick={onLogout}>
          {t("logout")}
        </Button>
        {onAccounts ? <SettingsMenu onAccounts={onAccounts} onUsage={onUsage} /> : null}
      </div>
    </header>
  )
}

const connectionClass =
  "ml-auto flex items-center gap-[4px] whitespace-nowrap rounded-full border border-border px-[7px] py-[4px] text-[10px] text-muted-foreground before:size-[6px] before:rounded-full before:bg-status-muted"

const actionClass = "h-[28px] px-[5px] py-0 text-[11px]"
