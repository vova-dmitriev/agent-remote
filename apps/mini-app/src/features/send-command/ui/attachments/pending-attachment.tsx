import { RotateCcw, X } from "lucide-react"
import { PendingAttachmentStatus } from "@/features/send-command/config/values"
import { ErrorCode } from "@protocol"
import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { useAttachmentPreview } from "@/features/send-command/model/use-attachment-preview"
import { UPLOAD_IDS } from "./test-ids"
import type { PendingAttachmentChipProps } from "./types"

export function PendingAttachmentChip({ item, disabled, remove, retry }: PendingAttachmentChipProps) {
  const { t } = useTranslation()
  const preview = useAttachmentPreview(item.file, item.preview)

  return (
    <div className="pending-attachment" data-testid={UPLOAD_IDS.pending} data-upload-id={item.id}>
      {preview ? <img src={preview} alt={item.file.name} data-testid={UPLOAD_IDS.image} /> : null}
      <span className="attachment-description">
        <strong>{item.file.name}</strong>
        <small data-testid={UPLOAD_IDS.status}>
          {item.status === PendingAttachmentStatus.Uploading
            ? t("attachmentUploading", { progress: item.progress })
            : item.status === PendingAttachmentStatus.Ready
              ? t("attachmentReady")
              : feedbackText(item.error ?? ErrorCode.ATTACHMENT_UPLOAD_FAILED, t)}
        </small>
      </span>
      {item.status === PendingAttachmentStatus.Error ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid={UPLOAD_IDS.retry}
          disabled={disabled}
          aria-label={t("attachmentRetry")}
          onClick={retry}
        >
          <RotateCcw aria-hidden="true" size={16} />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-testid={UPLOAD_IDS.remove}
        disabled={disabled}
        aria-label={t("attachmentRemove", { name: item.file.name })}
        onClick={remove}
      >
        <X aria-hidden="true" size={16} />
      </Button>
    </div>
  )
}
