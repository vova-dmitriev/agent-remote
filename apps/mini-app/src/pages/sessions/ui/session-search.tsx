import { Search, X } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Input } from "@/shared/ui/input"
import { SESSIONS_PAGE_IDS } from "../config/test-ids"
import type { SessionSearchProps } from "./sessions-page.types"

/** The session list's search on a phone, like the desktop sidebar's: title, project, model or agent. */
export function SessionSearch({ query, onQuery }: SessionSearchProps) {
  const { t } = useTranslation()

  return (
    <div className="relative mb-[8px] min-w-0 flex-1">
      <Search
        aria-hidden="true"
        size={16}
        className="pointer-events-none absolute top-1/2 left-[11px] -translate-y-1/2 text-muted-foreground"
      />
      <Input
        role="searchbox"
        aria-label={t("sidebarSearch")}
        placeholder={t("searchShort")}
        autoComplete="off"
        spellCheck={false}
        value={query}
        data-testid={SESSIONS_PAGE_IDS.search}
        className="h-[36px] rounded-[12px] pr-[34px] pl-[34px] text-[16px]"
        onChange={(event) => onQuery(event.target.value)}
      />
      {query ? (
        <button
          type="button"
          aria-label={t("sidebarClearSearch")}
          data-testid={SESSIONS_PAGE_IDS.searchClear}
          className="absolute top-1/2 right-[6px] grid size-[28px] -translate-y-1/2 place-items-center rounded-full text-muted-foreground"
          onClick={() => onQuery("")}
        >
          <X aria-hidden="true" size={15} />
        </button>
      ) : null}
    </div>
  )
}
