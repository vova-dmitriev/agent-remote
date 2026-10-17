import { File } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { ATTACHMENT_IDS } from "@/entities/attachment/config/test-ids"
import type { UnavailableAttachmentProps } from "./unavailable-attachment.types"

export function UnavailableAttachment({ name }: UnavailableAttachmentProps) {
  const { t } = useTranslation()

  return (
    <div className="attachment-card" data-testid={ATTACHMENT_IDS.unavailable} data-file-name={name}>
      <File aria-hidden="true" size={20} />
      <span className="attachment-description">
        <strong>{name}</strong>
        <small>{t("attachmentExpired")}</small>
      </span>
    </div>
  )
}
