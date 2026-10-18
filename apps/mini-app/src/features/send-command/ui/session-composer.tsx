import { ArrowUp } from "lucide-react"
import { CommandActionType, ConnectionStatus, DeviceStatus } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Textarea } from "@/shared/ui/textarea"
import { Label } from "@/shared/ui/label"
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
    <form className="composer" data-testid={COMMAND_IDS.root} onSubmit={controller.submit} {...attachmentEvents}>
      <PromptQueue queue={controller.outbox} />
      <Label htmlFor="prompt" data-testid={COMMAND_IDS.label}>
        {t("composerLabel")}
      </Label>
      <div className={"composer-input" + (session.capabilities.attachments ? " attachments-enabled" : "")}>
        {session.capabilities.attachments ? <AttachmentPicker model={controller.attachments} disabled={state.attachmentDisabled} /> : null}
        <Textarea
          id="prompt"
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
        <Button
          type="submit"
          size="icon"
          className="composer-send"
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
        <p className="muted" data-testid={COMMAND_IDS.availabilityHint}>
          {t(state.unavailableHint)}
        </p>
      ) : null}
    </form>
  )
}
