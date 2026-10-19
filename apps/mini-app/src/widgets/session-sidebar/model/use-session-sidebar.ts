import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from "react"
import type { Session } from "@protocol"
import { useProviderFilter } from "@/entities/session"
import { SidebarKey } from "../config/values"
import { filterSessions } from "../lib/sidebar-search"
import { groupByRecency } from "../lib/sidebar-groups"
import { rowDomId } from "../lib/row-dom-id"

interface SidebarModelOptions {
  sessions: Session[]
  activeId: string | null
  now: number
  collapsed: boolean
  onOpen: (session: Session) => void
  onExpand: () => void
}

/** Local interaction state for the sidebar: search, provider chips, keyboard cursor and the ⌘K shortcut. */
export function useSessionSidebar({ sessions, activeId, now, collapsed, onOpen, onExpand }: SidebarModelOptions) {
  const [query, setQuery] = useState("")
  const { provider, setProvider } = useProviderFilter()
  const [cursorId, setCursorId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const focusRequested = useRef(false)
  const sections = groupByRecency(filterSessions(sessions, query, provider), now)
  const order = sections.flatMap((section) => section.sessions)
  const cursor = order.find((session) => session.id === cursorId) ?? (query.trim() ? order[0] : undefined)

  const move = (step: number) => {
    if (!order.length) return

    const from = order.findIndex((session) => session.id === (cursor?.id ?? activeId))
    const start = step > 0 ? 0 : order.length - 1
    const next = order[from === -1 ? start : Math.min(order.length - 1, Math.max(0, from + step))]!

    setCursorId(next.id)
    document.getElementById(rowDomId(next.id))?.scrollIntoView({ block: "nearest" })
  }

  const open = (session: Session) => {
    setCursorId(null)
    onOpen(session)
  }

  const clear = () => {
    setQuery("")
    setCursorId(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === SidebarKey.Down || event.key === SidebarKey.Up) {
      event.preventDefault()
      move(event.key === SidebarKey.Down ? 1 : -1)
    } else if (event.key === SidebarKey.Enter && cursor) {
      event.preventDefault()
      open(cursor)
    } else if (event.key === SidebarKey.Escape) {
      if (query) clear()
      else setCursorId(null)
    }
  }

  const searchNode = (node: HTMLInputElement | null) => {
    searchRef.current = node

    if (node && focusRequested.current) {
      focusRequested.current = false
      node.focus()
    }
  }

  const requestSearch = () => {
    if (!collapsed) return searchRef.current?.focus()

    focusRequested.current = true
    onExpand()
  }

  const onShortcut = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === SidebarKey.Search) {
      event.preventDefault()
      requestSearch()
    }
  })

  useEffect(() => {
    window.addEventListener("keydown", onShortcut)

    return () => window.removeEventListener("keydown", onShortcut)
  }, [])

  return {
    query,
    setQuery: (value: string) => {
      setQuery(value)
      setCursorId(null)
    },
    provider,
    setProvider,
    sections,
    order,
    cursorId: cursor?.id ?? null,
    open,
    clear,
    onKeyDown,
    searchNode,
    requestSearch,
  }
}
