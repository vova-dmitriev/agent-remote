import { useLayoutEffect } from "react"
import { ArrowUp } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Textarea } from "@/shared/ui/textarea"
import { cn } from "@/shared/lib/utils"
import { composerState } from "@/features/send-command/lib/composer-state"
import type { SessionComposerProps } from "@/features/send-command/ui/types"
import { COMMAND_IDS } from "@/features/send-command/config/test-ids"
import { AttachmentPicker } from "../attachments/attachment-picker"
import { SkillsMenu } from "../slash/skills-menu"
import { useSlashSkills } from "@/features/send-command/model/slash/use-slash-skills"

export interface ComposerPromptProps {
  controller: SessionComposerProps["controller"]
  session: SessionComposerProps["session"]
  state: ReturnType<typeof composerState>
  prompt: string
  slash: ReturnType<typeof useSlashSkills>
  t: ReturnType<typeof useTranslation>["t"]
}

export function ComposerPrompt({ controller, session, state, prompt, slash, t }: ComposerPromptProps) {
  const input = slash.input

  // The prompt grows with its lines up to its max height, then scrolls. CSS field-sizing does this only in newer
  // WebKit (Telegram on macOS and iOS), so the height follows the content here.
  useLayoutEffect(() => {
    const node = input.current

    if (!node) return
    node.style.height = "auto"
    node.style.height = `${node.scrollHeight}px`
  }, [input, prompt])

  return (
    <div className="relative">
      {slash.open ? <SkillsMenu {...slash} /> : null}
      {session.capabilities.attachments ? <AttachmentPicker model={controller.attachments} disabled={state.attachmentDisabled} /> : null}
      <div className={promptFrameClass} data-testid={COMMAND_IDS.promptFrame}>
        <Textarea
          id="prompt"
          ref={slash.input}
          aria-autocomplete={slash.open ? "list" : undefined}
          aria-controls={slash.open ? slash.listId : undefined}
          aria-activedescendant={slash.open && slash.items.length ? `${slash.listId}-${slash.active}` : undefined}
          className={cn(promptClass, session.capabilities.attachments && promptWithAttachmentsClass)}
          data-testid={COMMAND_IDS.prompt}
          value={prompt}
          onChange={(event) => slash.change(event.target.value, event.target.selectionStart)}
          onSelect={(event) => slash.position(event.currentTarget.selectionStart)}
          onFocus={(event) => slash.focus(event.target.selectionStart)}
          onBlur={slash.dismiss}
          placeholder={t(state.promptDisabled ? "composerUnavailable" : "composerPlaceholder")}
          disabled={state.promptDisabled}
          onKeyDown={(event) => {
            if (slash.onKeyDown(event)) return
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
  )
}

const promptFrameClass =
  "rounded-[24px] border border-input bg-surface py-[10px] shadow-xs transition-[color,box-shadow] focus-within:ring-[3px] focus-within:ring-ring/50 short:py-[6px]"

const promptClass =
  "max-h-[144px] min-h-[24px] resize-none overflow-y-auto rounded-none border-0 bg-transparent p-0 pr-[50px] pl-[15px] text-[16px] leading-[24px] shadow-none focus-visible:ring-0 disabled:overflow-hidden short:max-h-[60px] short:min-h-[20px] short:pr-[48px] short:pl-[13px] short:leading-[20px]"

const promptWithAttachmentsClass = "pl-[46px] short:pl-[40px]"
