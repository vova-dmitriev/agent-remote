import { Search, X } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Input } from "@/shared/ui/input"
import { SESSION_SIDEBAR_IDS } from "../config/test-ids"
import type { SidebarSearchProps } from "./session-sidebar.types"

export function SidebarSearch({ query, inputRef, onQuery, onClear, onKeyDown }: SidebarSearchProps) {
  const { t } = useTranslation()

  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        size={15}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        role="searchbox"
        aria-label={t("sidebarSearch")}
        aria-keyshortcuts="Meta+K"
        placeholder={t("sidebarSearch")}
        autoComplete="off"
        spellCheck={false}
        value={query}
        data-testid={SESSION_SIDEBAR_IDS.search}
        className="h-8! rounded-md! bg-background! py-0! pr-12! pl-8! text-[13px]!"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {query ? (
        <button
          type="button"
          aria-label={t("sidebarClearSearch")}
          data-testid={SESSION_SIDEBAR_IDS.searchClear}
          className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onClear}
        >
          <X aria-hidden="true" size={13} />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border px-1 font-sans text-[10px] leading-4 text-muted-foreground">
          {t("sidebarShortcut")}
        </kbd>
      )}
    </div>
  )
}
