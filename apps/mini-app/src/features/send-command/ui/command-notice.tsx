import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { COMMAND_IDS } from "../config/test-ids"
import { commandErrorText, isUncertainCommand } from "../lib/notice"
import type { CommandNoticeProps } from "./types"

export function CommandNotice({ error, busy, retry }: CommandNoticeProps) {
  const { t } = useTranslation()

  if (!error) return null

  return (
    <div role="alert" className="notice error" data-testid={COMMAND_IDS.notice}>
      {commandErrorText(error, t)}
      {isUncertainCommand(error) ? (
        <Button variant="outline" data-testid={COMMAND_IDS.retry} disabled={busy} onClick={retry}>
          {t("retryCommand")}
        </Button>
      ) : null}
    </div>
  )
}
