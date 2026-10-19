import { Download, File, Image } from "lucide-react"
import { AttachmentKind, ErrorCode } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { ATTACHMENT_IDS } from "../config/test-ids"
import { useAttachment } from "../model/use-attachment"
import { ImageViewer } from "./image-viewer"
import { attachmentCardClass, attachmentChipClass, attachmentDescriptionClass, attachmentNoticeClass } from "./chip/attachment-chip-class"
import type { AttachmentCardProps } from "../model/types/attachment-card.types"

export function AttachmentCard({ sessionId, attachment }: AttachmentCardProps) {
  const { t } = useTranslation()
  const resource = useAttachment(sessionId, attachment)

  const code = resource.error instanceof Error ? resource.error.message : ""

  const expired = [ErrorCode.ATTACHMENT_EXPIRED, ErrorCode.ATTACHMENT_UNAVAILABLE, ErrorCode.NOT_FOUND].some(
    (candidate) => candidate === code,
  )

  return (
    <div className={cn(attachmentChipClass, attachmentCardClass)} data-testid={ATTACHMENT_IDS.root} data-attachment-id={attachment.id}>
      {attachment.kind === AttachmentKind.Image ? (
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-h-[80px] w-full basis-full overflow-hidden p-0 has-[>svg]:px-0"
          data-testid={ATTACHMENT_IDS.open}
          disabled={!resource.url}
          onClick={() => resource.setOpened(true)}
          aria-label={t("attachmentView", { name: attachment.name })}
        >
          {resource.url ? (
            <img
              className="block max-h-[240px] w-full object-contain"
              src={resource.url}
              alt={attachment.name}
              data-testid={ATTACHMENT_IDS.image}
            />
          ) : (
            <Image aria-hidden="true" size={24} />
          )}
        </Button>
      ) : (
        <File aria-hidden="true" size={20} />
      )}
      <span className={attachmentDescriptionClass}>
        <strong>{attachment.name}</strong>
        <small>
          {attachment.mimeType} · {t("attachmentSize", { size: Math.ceil(attachment.byteLength / 1024) })}
        </small>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-testid={ATTACHMENT_IDS.download}
        disabled={resource.loading}
        onClick={resource.download}
        aria-label={t("attachmentDownload", { name: attachment.name })}
      >
        <Download aria-hidden="true" size={18} />
      </Button>
      {resource.loading ? (
        <span className={attachmentNoticeClass} role="status" data-testid={ATTACHMENT_IDS.status}>
          {t("attachmentLoading")}
        </span>
      ) : null}
      {resource.error ? (
        <span className={attachmentNoticeClass} role="alert" data-testid={ATTACHMENT_IDS.status}>
          {t(expired ? "attachmentExpired" : "attachmentLoadError")}
          <Button type="button" variant="ghost" data-testid={ATTACHMENT_IDS.retry} onClick={resource.retry}>
            {t("attachmentRetry")}
          </Button>
        </span>
      ) : null}
      {resource.opened && resource.url ? (
        <ImageViewer
          key={resource.url}
          download={resource.download}
          url={resource.url}
          name={attachment.name}
          close={() => resource.setOpened(false)}
        />
      ) : null}
    </div>
  )
}
