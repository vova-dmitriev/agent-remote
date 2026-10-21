import { Search, X } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Input } from "@/shared/ui/input"
import { SESSIONS_PAGE_IDS } from "../config/test-ids"
import type { SessionSearchProps } from "./sessions-page.types"

/** The session list's search on a phone, like the desktop sidebar's: title, project, model or agent. */
export function SessionSearch({ query, onQuery }: SessionSearchProps) {
  const { t } = useTranslation()

  return (
    <div className="relative mb-[10px]">
      <Search
        aria-hidden="true"
        size={16}
        className="pointer-events-none absolute top-1/2 left-[12px] -translate-y-1/2 text-muted-foreground"
      />
      <Input
        role="searchbox"
        aria-label={t("sidebarSearch")}
        placeholder={t("sidebarSearch")}
        autoComplete="off"
        spellCheck={false}
        value={query}
        data-testid={SESSIONS_PAGE_IDS.search}
        className="h-[38px] rounded-[10px] pr-[38px] pl-[36px] text-[16px]"
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
