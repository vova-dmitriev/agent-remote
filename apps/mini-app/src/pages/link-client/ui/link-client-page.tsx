import { Puzzle } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { emptyStateTextClass } from "@/shared/ui/text"
import { LINK_CLIENT_IDS as IDS } from "../config/test-ids"
import { useLinkEntry } from "../model/use-link-entry"
import type { LinkClientPageProps } from "./link-client-page.types"

/** The Chrome extension's first screen: the code from the Mini App links it to the owner's sessions. */
export function LinkClientPage({ server, onLinked, onUseCompanion }: LinkClientPageProps) {
  const { t } = useTranslation()
  const entry = useLinkEntry(server, onLinked)

  return (
    <section className="mx-auto max-w-[360px] px-[20px] pt-[60px] text-center" data-testid={IDS.root}>
      <Puzzle className="mx-auto mb-[16px] size-[40px] text-primary" aria-hidden="true" />
      <h1 className="text-[22px] font-semibold">{t("linkEnterTitle")}</h1>
      <p className={emptyStateTextClass}>{t("linkEnterHint")}</p>
      <form
        className="mt-[20px] grid gap-[10px]"
        onSubmit={(event) => {
          event.preventDefault()
          if (!entry.busy) void entry.submit()
        }}
      >
        <Input
          aria-label={t("linkEnterCode")}
          placeholder="ABCD-EFGH"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          value={entry.code}
          data-testid={IDS.code}
          className="h-[44px] text-center font-mono text-[20px] tracking-[0.12em] uppercase"
          onChange={(event) => entry.setCode(event.target.value)}
        />
        <Button type="submit" disabled={entry.busy || !entry.code.trim()} data-testid={IDS.submit}>
          {t("linkEnterSubmit")}
        </Button>
        {entry.failed ? (
          <p className="text-[13px] text-danger" data-testid={IDS.failed}>
            {t("linkEnterFailed")}
          </p>
        ) : null}
      </form>
      <Button type="button" variant="link" className="mt-[24px] text-[13px]" data-testid={IDS.companion} onClick={onUseCompanion}>
        {t("linkUseCompanion")}
      </Button>
    </section>
  )
}
