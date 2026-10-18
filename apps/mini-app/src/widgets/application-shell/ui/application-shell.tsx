import { ConnectionStatus, CommandStatus, ErrorCode } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { feedbackText } from "@/shared/lib/i18n"
import { LanguageSwitcher } from "@/shared/ui/language-switcher"
import { ThemeSwitcher } from "@/shared/ui/theme-switcher"
import { Button } from "@/shared/ui/button"
import { useHost } from "@/shared/lib/host"
import { SHELL_IDS } from "../config/test-ids"
import type { ApplicationShellProps } from "./application-shell.types"

export function ApplicationShell({ connection, result, onHome, onLogout, children, compact = false }: ApplicationShellProps) {
  const { t } = useTranslation()
  const host = useHost()
  const online = connection === ConnectionStatus.Online

  return (
    <main className={compact ? "shell shell-session" : "shell"} data-testid={SHELL_IDS.root}>
      {!compact ? (
        <header>
          <Button variant="link" className="brand" data-testid={SHELL_IDS.home} onClick={onHome}>
            {t("brandName")} <span>{t("brandSuffix")}</span>
          </Button>
          <span className={"connection " + (online ? "online" : "")} data-testid={SHELL_IDS.connection}>
            {t(online ? ConnectionStatus.Online : connection === ConnectionStatus.Expired ? "loginRequired" : ConnectionStatus.Offline)}
          </span>
          <div className="app-actions">
            {host.capabilities.fullTab ? (
              <Button variant="link" data-testid={SHELL_IDS.openTab} onClick={() => void host.openFullTab?.()}>
                {t("extensionOpenFullTab")}
              </Button>
            ) : null}
            <LanguageSwitcher />
            <ThemeSwitcher />
            <Button variant="link" className="text-button" data-testid={SHELL_IDS.logout} onClick={onLogout}>
              {t("logout")}
            </Button>
          </div>
        </header>
      ) : null}
      {children}
      {result === CommandStatus.Dispatched || result === CommandStatus.Accepted || result === ErrorCode.PAIRING_CONFIRM_LOCAL ? (
        <p className="receipt" role="status" data-testid={SHELL_IDS.receipt}>
          {feedbackText(result, t)}
        </p>
      ) : null}
      {!compact ? <footer>{t("footer")}</footer> : null}
    </main>
  )
}
