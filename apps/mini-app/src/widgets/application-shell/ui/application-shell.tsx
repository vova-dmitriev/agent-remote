import { ConnectionStatus, CommandStatus, ErrorCode } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { feedbackText } from "@/shared/lib/i18n"
import { LanguageSwitcher } from "@/shared/ui/language-switcher"
import { ThemeSwitcher } from "@/shared/ui/theme-switcher"
import { Button } from "@/shared/ui/button"
import { useHost } from "@/shared/lib/host"
import { cn } from "@/shared/lib/utils"
import { SHELL_IDS } from "../config/test-ids"
import { ShellLayout } from "../config/values"
import type { ApplicationShellProps } from "./application-shell.types"

export function ApplicationShell({ connection, result, onHome, onLogout, children, compact = false }: ApplicationShellProps) {
  const { t } = useTranslation()
  const host = useHost()
  const online = connection === ConnectionStatus.Online

  return (
    <main
      className={compact ? sessionClass : pageClass}
      data-shell-layout={compact ? ShellLayout.Session : ShellLayout.Page}
      data-testid={SHELL_IDS.root}
    >
      {!compact ? (
        <header className="flex min-h-[36px] items-center justify-between gap-[10px] border-b border-border pb-[8px] tiny:flex-wrap">
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
          </div>
        </header>
      ) : null}
      {children}
      {result === CommandStatus.Dispatched || result === CommandStatus.Accepted || result === ErrorCode.PAIRING_CONFIRM_LOCAL ? (
        <p className={receiptClass} role="status" data-testid={SHELL_IDS.receipt}>
          {feedbackText(result, t)}
        </p>
      ) : null}
      {!compact ? (
        <footer className="mt-[40px] border-t border-border pt-[18px] text-center text-[11px] text-muted-foreground">{t("footer")}</footer>
      ) : null}
    </main>
  )
}

const pageClass =
  "m-auto max-w-[820px] px-[18px] pt-[calc(10px+env(safe-area-inset-top))] pb-[calc(16px+env(safe-area-inset-bottom))] phone:px-[14px]"

const sessionClass =
  "m-auto flex h-[var(--tg-viewport-height,100dvh)] max-h-dvh min-h-0 w-full max-w-[980px] flex-col overflow-hidden px-[18px] pt-[calc(6px+env(safe-area-inset-top))] pb-[calc(8px+env(safe-area-inset-bottom))] phone:px-[10px]"

const connectionClass =
  "ml-auto flex items-center gap-[4px] whitespace-nowrap rounded-full border border-border px-[7px] py-[4px] text-[10px] text-muted-foreground before:size-[6px] before:rounded-full before:bg-status-muted"

const actionClass = "h-[28px] px-[5px] py-0 text-[11px]"

const receiptClass =
  "p-[16px] text-center text-[12px] text-primary session:my-[5px] session:max-h-[14dvh] session:flex-none session:overflow-y-auto session:px-[10px] session:py-[7px] session:text-[11px] session:short:my-[3px] session:short:max-h-[32px] session:short:px-[8px] session:short:py-[4px] session:short:text-[10px]"
