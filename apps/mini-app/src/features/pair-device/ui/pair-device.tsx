import { Check, Copy } from "lucide-react"
import { CopyStatus, useCopyCode, useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { Label } from "@/shared/ui/label"
import { PAIR_DEVICE_IDS } from "../config/test-ids"
import type { PairDeviceProps } from "./pair-device.types"

export function PairDevice({ controller, online }: PairDeviceProps) {
  const { t } = useTranslation()
  const { copy, status } = useCopyCode("npm run personal")
  const copyLabel = t(status === CopyStatus.Copied ? "commandCopied" : status === CopyStatus.Failed ? "commandCopyFailed" : "copyCommand")

  return (
    <section className="pair-card" data-testid={PAIR_DEVICE_IDS.root}>
      <h2 data-testid={PAIR_DEVICE_IDS.title}>{t("pairTitle")}</h2>
      <p>{t("pairSimpleIntro")}</p>
      <div className="pair-command">
        <code data-testid={PAIR_DEVICE_IDS.command}>npm run personal</code>
        <Button
          variant="ghost"
          size="icon"
          data-testid={PAIR_DEVICE_IDS.copy}
          aria-label={copyLabel}
          title={copyLabel}
          onClick={() => void copy()}
        >
          {status === CopyStatus.Copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        </Button>
      </div>
      <p>{t("pairSimpleFinish")}</p>
      <details className="pair-manual">
        <summary data-testid={PAIR_DEVICE_IDS.manual}>{t("pairManual")}</summary>
        <p>{t("pairExpiry")}</p>
        <form onSubmit={(event) => void controller.submit(event)}>
          <Label htmlFor="pair-code">{t("pairCode")}</Label>
          <Input
            id="pair-code"
            data-testid={PAIR_DEVICE_IDS.code}
            value={controller.code}
            onChange={(event) => controller.setCode(event.target.value)}
            autoComplete="off"
            placeholder={t("pairPlaceholder")}
          />
          <Button
            type="submit"
            className="primary"
            data-testid={PAIR_DEVICE_IDS.submit}
            disabled={controller.busy || !online || !controller.code.trim()}
          >
            {t("pairTitle")}
          </Button>
        </form>
      </details>
      <p className="disclosure">{t("disclosure")}</p>
    </section>
  )
}
