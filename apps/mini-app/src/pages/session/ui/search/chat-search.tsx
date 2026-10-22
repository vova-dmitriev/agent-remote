import { Search, X } from "lucide-react"
import { useTranslation } from "@/shared/lib/hooks"
import { Button } from "@/shared/ui/button"
import { Input } from "@/shared/ui/input"
import { CHAT_SEARCH_IDS } from "@/pages/session/config/test-ids"
import { useChatSearch } from "@/pages/session/model/history/use-chat-search"
import { ChatSearchResult } from "./chat-search-result"
import type { ChatSearchProps } from "./chat-search.types"

/** Search in the chat: words typed here find messages of the whole conversation, loaded or not. */
export function ChatSearch({ open, session, agent, onPick, onClose }: ChatSearchProps) {
  const { t } = useTranslation()
  const search = useChatSearch(session)
  const matches = search.matches ?? []

  if (!open) return null

  return (
    <div className="relative z-10 mb-[6px] grid gap-[4px]" data-testid={CHAT_SEARCH_IDS.root}>
      <div className="relative">
        <Search
          aria-hidden="true"
          size={16}
          className="pointer-events-none absolute top-1/2 left-[11px] -translate-y-1/2 text-muted-foreground"
        />
        <Input
          role="searchbox"
          aria-label={t("searchInChat")}
          placeholder={t("chatSearchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={search.text}
          data-testid={CHAT_SEARCH_IDS.input}
          className="h-[36px] rounded-[12px] pr-[38px] pl-[34px] text-[16px]"
          onChange={(event) => search.setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose()
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("chatSearchClose")}
          data-testid={CHAT_SEARCH_IDS.close}
          className="absolute top-1/2 right-[4px] size-[30px] -translate-y-1/2 rounded-full text-muted-foreground"
          onClick={onClose}
        >
          <X aria-hidden="true" size={15} />
        </Button>
      </div>
      {search.failed ? (
        <p className="px-[4px] text-[13px] text-danger" data-testid={CHAT_SEARCH_IDS.failed}>
          {t("chatSearchFailed")}
        </p>
      ) : null}
      {search.matches && !matches.length ? (
        <p className="px-[4px] text-[13px] text-muted-foreground" data-testid={CHAT_SEARCH_IDS.empty}>
          {t("chatSearchEmpty", { query: search.query })}
        </p>
      ) : null}
      {matches.length ? (
        <>
          <p className="px-[4px] text-[12px] text-muted-foreground" data-testid={CHAT_SEARCH_IDS.count}>
            {t("chatSearchCount", { count: matches.length })}
          </p>
          <div
            className="max-h-[min(16rem,30dvh)] overflow-y-auto rounded-[12px] border border-border bg-surface p-[4px]"
            data-testid={CHAT_SEARCH_IDS.results}
            aria-label={t("chatSearchResults")}
          >
            {matches.map((message) => (
              <ChatSearchResult key={message.id} message={message} query={search.query} agent={agent} onPick={onPick} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
