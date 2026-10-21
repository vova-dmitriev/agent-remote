import { useTranslation } from "@/shared/lib/hooks"
import { Label, formLabelClass } from "@/shared/ui/label"
import { cn } from "@/shared/lib/utils"
import { composerState } from "../lib/composer-state"
import { useDraftText } from "../model/use-session-drafts"
import { COMMAND_IDS } from "../config/test-ids"
import { useComposerAttachments } from "../model/use-composer-attachments"
import type { SessionComposerProps } from "./types"
import { useSlashSkills } from "../model/slash/use-slash-skills"
import { PromptQueue } from "./outbox/prompt-queue"
import { ComposerPrompt } from "./composer/prompt"
import { ComposerHints } from "./composer/hints"

export function SessionComposer({ controller, session, connection, deviceStatus }: SessionComposerProps) {
  const { t } = useTranslation()
  const prompt = useDraftText(controller.drafts, session.id)
  const state = composerState(controller, prompt, session, connection, deviceStatus)
  const slash = useSlashSkills({ session, prompt, disabled: state.promptDisabled, setPrompt: controller.setPrompt })
  const attachmentEvents = useComposerAttachments(controller, state.acceptsAttachments)

  return (
    <form
      className="relative z-20 border-t border-border pt-[4px] session:flex-none session:border-t-0 session:pt-[8px] session:short:pt-[5px]"
      data-testid={COMMAND_IDS.root}
      onSubmit={controller.submit}
      {...attachmentEvents}
    >
      <PromptQueue queue={controller.outbox} />
      <Label className={labelClass} htmlFor="prompt" data-testid={COMMAND_IDS.label}>
        {t("composerLabel")}
      </Label>
      <ComposerPrompt controller={controller} session={session} state={state} prompt={prompt} slash={slash} t={t} />
      <ComposerHints controller={controller} session={session} connection={connection} deviceStatus={deviceStatus} state={state} t={t} />
    </form>
  )
}

const labelClass = cn(
  formLabelClass,
  "session:absolute session:size-px session:overflow-hidden session:whitespace-nowrap session:[clip-path:inset(50%)]",
)

// The frame carries the border and the vertical padding, so scrolled text stops short of the border.
