import * as Popover from "@radix-ui/react-popover"
import { useTranslation } from "@/shared/lib/hooks"
import { feedbackText } from "@/shared/lib/i18n"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { cn } from "@/shared/lib/utils"
import { formLabelClass } from "@/shared/ui/label"
import { RENAME_SESSION_IDS as IDS } from "../config/test-ids"
import { useTitleEditor } from "../model/use-title-editor"
import type { SessionTitleProps } from "./session-title.types"

export function SessionTitle({ title, controller, disabled }: SessionTitleProps) {
  const { t } = useTranslation()
  const editor = useTitleEditor(title, controller)

  return (
    <Popover.Root open={editor.open} onOpenChange={editor.changeOpen}>
      <Popover.Trigger asChild>
        <button
          className="block w-full cursor-pointer overflow-hidden rounded-[4px] text-left text-ellipsis whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-primary disabled:cursor-default"
          data-testid={IDS.trigger}
          disabled={disabled}
          title={t("renameSession")}
        >
          {title}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-[70] w-[min(340px,calc(100vw_-_24px))] rounded-[16px] border border-border bg-surface p-[16px] text-foreground shadow-[0_12px_32px_color-mix(in_srgb,var(--foreground)_12%,transparent)]"
          data-testid={IDS.root}
          sideOffset={8}
          collisionPadding={12}
          align="start"
          aria-label={t("renameSession")}
        >
          <form className="grid gap-[10px]" onSubmit={(event) => void editor.submit(event)}>
            <label className={cn(formLabelClass, "font-semibold")} htmlFor="session-title">
              {t("renameSession")}
            </label>
            <Input
              id="session-title"
              data-testid={IDS.input}
              value={editor.value}
              onChange={(event) => editor.setValue(event.target.value)}
              maxLength={512}
              disabled={controller.busy}
            />
            <p className="text-[12px] text-muted-foreground">{t("sessionNameScope")}</p>
            {editor.error ? (
              <p role="alert" data-testid={IDS.error}>
                {feedbackText(editor.error, t)}
              </p>
            ) : null}
            <div className="flex justify-end gap-[8px]">
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
