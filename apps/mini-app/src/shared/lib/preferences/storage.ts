import { MessageRole, preferencePatchSchema, type PreferencePatch } from "@protocol"

export function preferenceStorage(initData: string) {
  let account: string | undefined

  try {
    const user = JSON.parse(new URLSearchParams(initData).get(MessageRole.User) ?? "null") as { id?: unknown } | null

    if (typeof user?.id === "number" || typeof user?.id === "string") account = String(user.id)
  } catch {
    /* An absent identity keeps unsaved choices in memory only. */
  }

  const key = account ? "claude-remote.preferences.pending.v1:" + account : undefined

  return {
    read(): PreferencePatch {
      try {
        const parsed = preferencePatchSchema.safeParse(JSON.parse((key && localStorage.getItem(key)) || "{}"))

        return parsed.success ? parsed.data : {}
      } catch {
        return {}
      }
    },
    write(patch: PreferencePatch) {
      if (!key) return

      try {
        if (Object.keys(patch).length) localStorage.setItem(key, JSON.stringify(patch))
        else localStorage.removeItem(key)
      } catch {
        /* The in-memory outbox remains available until the webview closes. */
      }
    },
  }
}
