import { ArrowUp } from "lucide-react"
import { CommandActionType, ConnectionStatus, DeviceStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Textarea } from "@/shared/ui/textarea"
import { Label, formLabelClass } from "@/shared/ui/label"
import { cn } from "@/shared/lib/utils"
import { mutedTextClass } from "@/shared/ui/text"
import { NativeInputHelp } from "./native-input/native-input-help"
import { composerState } from "../lib/composer-state"
import { COMMAND_IDS } from "../config/test-ids"
import { useComposerAttachments } from "../model/use-composer-attachments"
import { AttachmentPicker } from "./attachments/attachment-picker"
import type { SessionComposerProps } from "./types"
import { PromptQueue } from "./outbox/prompt-queue"

export function SessionComposer({ controller, session, connection, deviceStatus }: SessionComposerProps) {
  const { t } = useTranslation()
  const state = composerState(controller, session, connection, deviceStatus)
  const attachmentEvents = useComposerAttachments(controller, state.acceptsAttachments)

  return (
    <form
      className="border-t border-border pt-[4px] session:flex-none session:border-t-0 session:pt-[8px] session:short:pt-[5px]"
      data-testid={COMMAND_IDS.root}
      onSubmit={controller.submit}
      {...attachmentEvents}
    >
      <PromptQueue queue={controller.outbox} />
      <Label className={labelClass} htmlFor="prompt" data-testid={COMMAND_IDS.label}>
        {t("composerLabel")}
      </Label>
      <div className="relative">
        {session.capabilities.attachments ? <AttachmentPicker model={controller.attachments} disabled={state.attachmentDisabled} /> : null}
        <div className={promptFrameClass}>
          <Textarea
            id="prompt"
            className={cn(promptClass, session.capabilities.attachments && promptWithAttachmentsClass)}
            data-testid={COMMAND_IDS.prompt}
            value={controller.prompt}
            onChange={(event) => controller.setPrompt(event.target.value)}
            placeholder={t(state.promptDisabled ? "composerUnavailable" : "composerPlaceholder")}
            disabled={state.promptDisabled}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
              event.preventDefault()
              if (!event.repeat && !state.sendDisabled) event.currentTarget.form?.requestSubmit()
            }}
            rows={1}
          />
        </div>
        <Button
          type="submit"
          size="icon"
          className="absolute right-[7px] bottom-[7px] size-[32px] rounded-full bg-foreground p-0 text-background hover:bg-foreground short:bottom-[4px] short:size-[26px]"
          data-testid={COMMAND_IDS.send}
          aria-label={t("send")}
          disabled={state.sendDisabled}
        >
          <ArrowUp aria-hidden="true" size={18} />
        </Button>
      </div>
      {state.showNativeHint ? (
        <NativeInputHelp
          session={session}
          onRestart={() => void controller.action({ type: CommandActionType.RestartSession })}
          disabled={
            controller.busy ||
            controller.awaitingReceipt ||
            controller.uncertain ||
            connection !== ConnectionStatus.Online ||
            deviceStatus !== DeviceStatus.Online
          }
        />
      ) : null}
      {state.unavailableHint && !state.showNativeHint ? (
        <p className={mutedTextClass} data-testid={COMMAND_IDS.availabilityHint}>
          {t(state.unavailableHint)}
        </p>
      ) : null}
    </form>
  )
}

const labelClass = cn(
  formLabelClass,
  "session:absolute session:size-px session:overflow-hidden session:whitespace-nowrap session:[clip-path:inset(50%)]",
)

// The frame carries the border and the vertical padding, so scrolled text stops short of the border.
const promptFrameClass =
  "rounded-[24px] border border-input bg-surface py-[10px] shadow-xs transition-[color,box-shadow] focus-within:ring-[3px] focus-within:ring-ring/50 short:py-[6px]"

const promptClass =
  "max-h-[66px] min-h-[24px] resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 pr-[50px] pl-[15px] text-[16px] leading-[24px] shadow-none focus-visible:ring-0 disabled:overflow-hidden short:max-h-[36px] short:min-h-[20px] short:pr-[48px] short:pl-[13px] short:leading-[20px]"

const promptWithAttachmentsClass = "pl-[46px] short:pl-[40px]"
