import { File } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { cn } from "@/shared/lib/utils"
import { ATTACHMENT_IDS } from "@/entities/attachment/config/test-ids"
import { attachmentCardClass, attachmentChipClass, attachmentDescriptionClass } from "@/entities/attachment/ui/chip/attachment-chip-class"
import type { UnavailableAttachmentProps } from "./unavailable-attachment.types"

export function UnavailableAttachment({ name }: UnavailableAttachmentProps) {
  const { t } = useTranslation()

  return (
    <div className={cn(attachmentChipClass, attachmentCardClass)} data-testid={ATTACHMENT_IDS.unavailable} data-file-name={name}>
      <File aria-hidden="true" size={20} />
      <span className={attachmentDescriptionClass}>
        <strong>{name}</strong>
        <small>{t("attachmentExpired")}</small>
      </span>
    </div>
  )
}
