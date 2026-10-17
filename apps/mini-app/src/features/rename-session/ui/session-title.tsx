import * as Popover from "@radix-ui/react-popover"
import { useTranslation } from "@/shared/lib/hooks"
import { feedbackText } from "@/shared/lib/i18n"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { RENAME_SESSION_IDS as IDS } from "../config/test-ids"
import { useTitleEditor } from "../model/use-title-editor"
import type { SessionTitleProps } from "./session-title.types"

export function SessionTitle({ title, controller, disabled }: SessionTitleProps) {
  const { t } = useTranslation()
  const editor = useTitleEditor(title, controller)

  return (
    <Popover.Root open={editor.open} onOpenChange={editor.changeOpen}>
      <Popover.Trigger asChild>
        <button className="session-title-trigger" data-testid={IDS.trigger} disabled={disabled} title={t("renameSession")}>
          {title}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="session-title-editor"
          data-testid={IDS.root}
          sideOffset={8}
          collisionPadding={12}
          align="start"
          aria-label={t("renameSession")}
        >
          <form onSubmit={(event) => void editor.submit(event)}>
            <label htmlFor="session-title">{t("renameSession")}</label>
            <Input
              id="session-title"
              data-testid={IDS.input}
              value={editor.value}
              onChange={(event) => editor.setValue(event.target.value)}
              maxLength={512}
              disabled={controller.busy}
            />
            <p className="muted">{t("sessionNameScope")}</p>
            {editor.error ? (
              <p role="alert" data-testid={IDS.error}>
                {feedbackText(editor.error, t)}
              </p>
            ) : null}
            <div className="session-title-actions">
              <Button
                type="button"
                variant="ghost"
                data-testid={IDS.cancel}
                onClick={() => editor.changeOpen(false)}
                disabled={controller.busy}
              >
                {t("cancelSessionName")}
              </Button>
              <Button type="submit" data-testid={IDS.save} disabled={controller.busy || !editor.value.trim()}>
                {t("saveSessionName")}
              </Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
