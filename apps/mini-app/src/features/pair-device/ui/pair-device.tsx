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
    <section
      className="mt-[16px] rounded-[16px] border border-border bg-surface p-[26px] phone:p-[20px]"
      data-testid={PAIR_DEVICE_IDS.root}
    >
      <h2 data-testid={PAIR_DEVICE_IDS.title}>{t("pairTitle")}</h2>
      <p className={paragraphClass}>{t("pairSimpleIntro")}</p>
      <div className="my-[16px] flex items-center justify-between gap-[12px] rounded-[9px] border border-border px-[12px] py-[8px]">
        <code className="text-[13px] wrap-anywhere" data-testid={PAIR_DEVICE_IDS.command}>
          npm run personal
        </code>
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
      <p className={paragraphClass}>{t("pairSimpleFinish")}</p>
      <details className="mt-[20px] border-t border-border pt-[16px]">
        <summary
          className="cursor-pointer text-[13px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          data-testid={PAIR_DEVICE_IDS.manual}
        >
          {t("pairManual")}
        </summary>
        <p className={paragraphClass}>{t("pairExpiry")}</p>
        <form onSubmit={(event) => void controller.submit(event)}>
          <Label className="mt-[20px] mb-[9px] block text-[12px] leading-[calc(1.25/0.875)]" htmlFor="pair-code">
            {t("pairCode")}
          </Label>
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
            className="mt-[14px] w-full rounded-[8px] border border-transparent px-[18px] py-[12px] text-[13px] font-semibold hover:bg-primary focus-visible:border-transparent"
            data-testid={PAIR_DEVICE_IDS.submit}
            disabled={controller.busy || !online || !controller.code.trim()}
          >
            {t("pairTitle")}
          </Button>
        </form>
      </details>
      <p className="mt-[20px] border-t border-border pt-[14px] text-[12px] leading-[1.65] text-muted-foreground">{t("disclosure")}</p>
    </section>
  )
}

const paragraphClass = "mt-[13px] leading-[1.65] text-muted-foreground"
