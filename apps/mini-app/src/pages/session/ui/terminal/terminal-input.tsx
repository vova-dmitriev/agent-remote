import { CornerDownLeft } from "lucide-react"
import { TerminalKey } from "@protocol"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { TERMINAL_INPUT_IDS } from "@/pages/session/config/test-ids"
import { useTerminalInput } from "@/pages/session/model/terminal/use-terminal-input"
import type { TerminalInputProps } from "./terminal-input.types"

/** The keys a phone keyboard lacks, in the order a terminal needs them. */
const KEYS = [
  { key: TerminalKey.Escape, label: "Esc" },
  { key: TerminalKey.Tab, label: "Tab" },
  { key: TerminalKey.Up, label: "↑" },
  { key: TerminalKey.Down, label: "↓" },
  { key: TerminalKey.Interrupt, label: "Ctrl-C" },
] as const

/** The Terminal tab's input: a line typed into the session's terminal with Enter, and the keys a phone lacks. */
export function TerminalInput({ session }: TerminalInputProps) {
  const { t } = useTranslation()
  const input = useTerminalInput(session)

  return (
    <form
      className="grid gap-[6px] border-t border-border pt-[6px] session:border-t-0"
      data-testid={TERMINAL_INPUT_IDS.root}
      onSubmit={(event) => {
        event.preventDefault()
        void input.submit(TerminalKey.Enter)
      }}
    >
      <div className="flex flex-wrap gap-[6px]">
        {KEYS.map(({ key, label }) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            size="sm"
            className="h-[30px] min-w-[44px] rounded-[9px] px-[10px] font-mono text-[13px]"
            data-testid={TERMINAL_INPUT_IDS.key}
            data-key={key}
            onClick={() => input.press(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="relative">
        <Input
          aria-label={t("terminalInput")}
          placeholder={t("terminalInputPlaceholder")}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={input.text}
          data-testid={TERMINAL_INPUT_IDS.text}
          className="h-[40px] rounded-[12px] pr-[46px] font-mono text-[16px]"
          onChange={(event) => input.setText(event.target.value)}
        />
        <Button
          type="submit"
          size="icon"
          aria-label={t("terminalInputSend")}
          title={t("terminalInputSend")}
          data-testid={TERMINAL_INPUT_IDS.send}
          className="absolute top-1/2 right-[5px] size-[30px] -translate-y-1/2 rounded-full bg-foreground text-background hover:bg-foreground"
        >
          <CornerDownLeft aria-hidden="true" size={16} />
        </Button>
      </div>
      {input.error ? (
        <p className="text-[12px] text-danger" data-testid={TERMINAL_INPUT_IDS.error}>
          {t("terminalInputFailed")}
        </p>
      ) : null}
    </form>
  )
}
