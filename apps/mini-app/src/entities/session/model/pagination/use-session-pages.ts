import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ProviderFilterValue, type Session } from "@protocol"
import { filterByProvider } from "@/entities/session/lib/selectors"
import { useStableCallback } from "@/shared/lib/hooks"
import { mergeSessionPages } from "./merge-pages"

export type SessionPageLoader = (
  provider: ProviderFilterValue,
  cursor?: string,
) => Promise<{ sessions: Session[]; nextCursor: string | null }>

interface SessionPagesOptions {
  snapshot: Session[]
  scope: string | null
  provider: ProviderFilterValue
  loadPage?: SessionPageLoader | undefined
}

interface PageState {
  scope: string | null
  pages: Partial<Record<ProviderFilterValue, Session[]>>
  cursors: Partial<Record<ProviderFilterValue, string | null>>
  failures: ReadonlySet<ProviderFilterValue>
  loading: ProviderFilterValue | null
}

const emptyPages: PageState = { scope: null, pages: {}, cursors: {}, failures: new Set(), loading: null }

export function useSessionPages({ snapshot, scope, provider, loadPage }: SessionPagesOptions) {
  const [stored, setStored] = useState<PageState>(emptyPages)
  const inFlight = useRef(new Set<string>())
  const currentScope = useRef(scope)

  useLayoutEffect(() => {
    currentScope.current = scope
  }, [scope])

  const state = stored.scope === scope ? stored : { ...emptyPages, scope }

  const request = useStableCallback(async (target: ProviderFilterValue, cursor?: string) => {
    if (!loadPage || !scope) return
    const requestKey = `${scope}\u0000${target}`

    if (inFlight.current.has(requestKey)) return
    inFlight.current.add(requestKey)

    setStored((previous) => ({
      ...(previous.scope === scope ? previous : { ...emptyPages, scope }),
      loading: target,
    }))

    try {
      const page = await loadPage(target, cursor)

      if (currentScope.current !== scope) return

      setStored((previous) => {
        const current = previous.scope === scope ? previous : { ...emptyPages, scope }
        const sessions = new Map((current.pages[target] ?? []).map((session) => [session.id, session]))

        for (const session of page.sessions) sessions.set(session.id, session)

        return {
          ...current,
          pages: { ...current.pages, [target]: [...sessions.values()] },
          cursors: { ...current.cursors, [target]: page.nextCursor },
          failures: new Set([...current.failures].filter((item) => item !== target)),
        }
      })
    } catch {
      if (currentScope.current === scope)
        setStored((previous) => {
          const current = previous.scope === scope ? previous : { ...emptyPages, scope }

          return { ...current, failures: new Set(current.failures).add(target) }
        })
    } finally {
      inFlight.current.delete(requestKey)
      if (currentScope.current === scope)
        setStored((previous) => (previous.scope === scope && previous.loading === target ? { ...previous, loading: null } : previous))
    }
  })

  const hasLoader = !!loadPage

  useEffect(() => {
    if (hasLoader && state.pages[provider] === undefined) void request(provider)
  }, [provider, scope, state.pages, hasLoader, request])

  const loadMore = useStableCallback(() => {
    const loaded = state.pages[provider]

    if (loaded === undefined) void request(provider)
    else if (state.cursors[provider]) void request(provider, state.cursors[provider]!)
  })

  const retry = useStableCallback(() => {
    void request(provider, state.cursors[provider] ?? undefined)
  })

  return {
    sessions: mergeSessionPages(filterByProvider(snapshot, provider), state.pages[provider] ?? []),
    loadMore,
    retry,
    loading: state.loading === provider,
    failed: state.failures.has(provider),
    hasMore: state.pages[provider] === undefined || !!state.cursors[provider],
  }
}
