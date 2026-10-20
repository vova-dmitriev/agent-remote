import { CommandStatus, ErrorCode } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { feedbackText } from "@/shared/lib/i18n"
import { SHELL_IDS } from "../config/test-ids"
import { ShellHeader } from "./header/shell-header"
import { SESSION_SHELL_CLASS, ShellLayout } from "../config/values"
import type { ApplicationShellProps } from "./application-shell.types"

export function ApplicationShell({
  connection,
  result,
  onHome,
  onLogout,
  onAccounts,
  children,
  compact = false,
  chrome = true,
}: ApplicationShellProps) {
  const { t } = useTranslation()

  return (
    <main
      className={compact ? SESSION_SHELL_CLASS : pageClass}
      data-shell-layout={compact ? ShellLayout.Session : ShellLayout.Page}
      data-testid={SHELL_IDS.root}
    >
      {!compact && chrome ? (
        <ShellHeader
          connection={connection}
          onHome={onHome}
          onLogout={onLogout}
          onAccounts={onAccounts}
          className="min-h-[36px] border-b border-border pb-[8px] tiny:flex-wrap"
        />
      ) : null}
      {children}
      {result === CommandStatus.Dispatched || result === CommandStatus.Accepted || result === ErrorCode.PAIRING_CONFIRM_LOCAL ? (
        <p className={receiptClass} role="status" data-testid={SHELL_IDS.receipt}>
          {feedbackText(result, t)}
        </p>
      ) : null}
      {!compact && chrome ? (
        <footer className="mt-[40px] border-t border-border pt-[18px] text-center text-[11px] text-muted-foreground">{t("footer")}</footer>
      ) : null}
    </main>
  )
}

const pageClass =
  "m-auto max-w-[820px] px-[18px] pt-[calc(10px+env(safe-area-inset-top))] pb-[calc(16px+env(safe-area-inset-bottom))] phone:px-[14px]"

const receiptClass =
  "p-[16px] text-center text-[12px] text-primary session:my-[5px] session:max-h-[14dvh] session:flex-none session:overflow-y-auto session:px-[10px] session:py-[7px] session:text-[11px] session:short:my-[3px] session:short:max-h-[32px] session:short:px-[8px] session:short:py-[4px] session:short:text-[10px]"
