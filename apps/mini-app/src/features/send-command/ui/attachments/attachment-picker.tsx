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
    <div className="contents" data-testid={UPLOAD_IDS.root}>
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
        className="absolute bottom-[7px] left-[7px] size-[32px] rounded-full p-0 transition-[color,background-color,opacity] short:bottom-[4px] short:size-[26px]"
        data-testid={UPLOAD_IDS.select}
        disabled={disabled}
        aria-label={t("attachmentSelect")}
        onClick={() => input.current?.click()}
      >
        <Paperclip aria-hidden="true" size={18} />
      </Button>
      {model.items.length ? (
        <div className="mb-[6px] flex max-h-[104px] min-w-0 gap-[6px] overflow-x-auto">
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
        <p className="mb-[6px] basis-full text-[12px]" role="alert" data-testid={UPLOAD_IDS.error}>
          {feedbackText(model.error, t)}
        </p>
      ) : null}
    </div>
  )
}
