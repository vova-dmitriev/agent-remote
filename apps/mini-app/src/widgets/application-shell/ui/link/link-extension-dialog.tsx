import { useState } from "react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Modal } from "@/shared/ui/modal"
import { LINK_EXTENSION_IDS as IDS } from "@/widgets/application-shell/config/test-ids"
import { displayCode, timeLeft } from "@/widgets/application-shell/lib/link-code"
import { useLinkCode } from "@/widgets/application-shell/model/use-link-code"
import type { LinkExtensionDialogProps } from "./link-extension-dialog.types"

/** Shows a one-time code that links the Chrome extension to this owner's sessions. */
export function LinkExtensionDialog({ open, onClose }: LinkExtensionDialogProps) {
  const { t } = useTranslation()
  const { link, failed, left, issue } = useLinkCode(open)
  const [copied, setCopied] = useState(false)
  const expired = !!link && left <= 0

  return (
    <Modal open={open} title={t("linkExtension")} onClose={onClose} testId={IDS.dialog}>
      <p className="mt-[6px] text-[13px] leading-[19px] text-muted-foreground">{t("linkExtensionHint")}</p>
      {link && !expired ? (
        <>
          <p className="mt-[16px] text-center font-mono text-[30px] font-semibold tracking-[0.12em]" data-testid={IDS.code}>
            {displayCode(link.code)}
          </p>
          <p className="mt-[4px] text-center text-[12px] text-muted-foreground" data-testid={IDS.expires}>
            {t("linkExtensionExpires", { time: timeLeft(left) })}
          </p>
        </>
      ) : null}
      {expired ? <p className="mt-[16px] text-center text-[13px] text-muted-foreground">{t("linkExtensionExpired")}</p> : null}
      {failed ? (
        <p className="mt-[16px] text-[13px] text-danger" data-testid={IDS.failed}>
          {t("linkExtensionFailed")}
        </p>
      ) : null}
      <div className="mt-[18px] flex justify-end gap-[8px]">
        {expired || failed ? (
          <Button type="button" variant="ghost" data-testid={IDS.renew} onClick={() => void issue()}>
            {t("linkExtensionNew")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={!link}
            data-testid={IDS.copy}
            onClick={() => {
              if (link) void navigator.clipboard?.writeText(link.code).then(() => setCopied(true))
            }}
          >
            {t(copied ? "linkExtensionCopied" : "linkExtensionCopy")}
          </Button>
        )}
        <Button type="button" data-testid={IDS.done} onClick={onClose}>
          {t("linkExtensionDone")}
        </Button>
      </div>
    </Modal>
  )
}
