import { useRef } from "react"
import { Paperclip } from "lucide-react"
import { feedbackText } from "@/shared/lib/i18n"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { PendingAttachmentChip } from "./pending-attachment"
import { UPLOAD_IDS } from "./test-ids"
import type { AttachmentPickerProps } from "./types"

export function AttachmentPicker({ model, disabled }: AttachmentPickerProps) {
  const input = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()

  return (
    <div className="attachment-picker" data-testid={UPLOAD_IDS.root}>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid={UPLOAD_IDS.input}
        disabled={disabled}
        onChange={(event) => {
          model.add(Array.from(event.target.files ?? []))
          event.target.value = ""
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="composer-attach"
        data-testid={UPLOAD_IDS.select}
        disabled={disabled}
        aria-label={t("attachmentSelect")}
        onClick={() => input.current?.click()}
      >
        <Paperclip aria-hidden="true" size={18} />
      </Button>
      {model.items.length ? (
        <div className="pending-attachments">
          {model.items.map((item) => (
            <PendingAttachmentChip
              key={item.id}
              item={item}
              disabled={disabled}
              remove={() => model.remove(item.id)}
              retry={() => model.retry(item.id)}
            />
          ))}
        </div>
      ) : null}
      {model.error ? (
        <p role="alert" data-testid={UPLOAD_IDS.error}>
          {feedbackText(model.error, t)}
        </p>
      ) : null}
    </div>
  )
}
