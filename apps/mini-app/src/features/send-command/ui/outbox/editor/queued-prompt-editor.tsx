import { useTranslation } from "@/shared/lib/hooks"
import { feedbackText } from "@/shared/lib/i18n"
import { Button } from "@/shared/ui/button"
import { Textarea } from "@/shared/ui/textarea"
import { COMMAND_IDS } from "@/features/send-command/config/test-ids"
import { useQueuedPromptEditor } from "@/features/send-command/model/outbox/use-queued-prompt-editor"
import type { QueuedPromptEditorProps } from "./queued-prompt-editor.types"

export function QueuedPromptEditor({ item, queue }: QueuedPromptEditorProps) {
  const { t } = useTranslation()
  const editor = useQueuedPromptEditor({ item, queue })

  return (
    <div className="grid w-full gap-2" data-testid={COMMAND_IDS.queuedEditor}>
      <Textarea
        data-testid={COMMAND_IDS.queuedEditorText}
        value={editor.text}
        onChange={(event) => editor.change(event.target.value)}
        onPaste={editor.isolateEditor}
        onDrop={editor.isolateEditor}
        onDragOver={editor.isolateEditor}
        aria-label={t("queuedPromptEditor")}
        aria-invalid={Boolean(editor.error)}
        rows={2}
      />
      {editor.error ? (
        <span className="muted" role="alert" data-testid={COMMAND_IDS.queuedEditError}>
          {feedbackText(editor.error, t)}
        </span>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" data-testid={COMMAND_IDS.saveQueuedEdit} onClick={editor.save}>
          {t("saveQueuedPrompt")}
        </Button>
        <Button type="button" variant="ghost" data-testid={COMMAND_IDS.cancelQueuedEdit} onClick={editor.cancel}>
          {t("cancelQueuedEdit")}
        </Button>
      </div>
    </div>
  )
}
