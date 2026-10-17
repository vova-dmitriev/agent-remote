import { ErrorCode, type AccountPreferences, type PreferencePatch } from "@protocol"

interface Options {
  read: () => PreferencePatch
  write: (patch: PreferencePatch) => void
  apply: (patch: PreferencePatch) => void
  save: (patch: PreferencePatch) => Promise<AccountPreferences>
  error: (value: string) => void
  ready?: () => void
}

export class PreferenceSync {
  private pending: PreferencePatch
  private hydrated = false
  private online = false
  private closed = false
  private saving = false

  constructor(private options: Options) {
    this.pending = options.read()
    if (Object.keys(this.pending).length) options.apply(this.pending)
  }

  setOnline(online: boolean) {
    this.online = online
    if (online) void this.flush()
  }

  hydrate(value: AccountPreferences) {
    if (this.closed || this.hydrated) return
    this.hydrated = true

    this.options.apply({
      ...(value.language ? { language: value.language } : {}),
      ...(value.theme ? { theme: value.theme } : {}),
      ...this.pending,
    })

    this.options.ready?.()
    void this.flush()
  }

  change(patch: PreferencePatch) {
    if (this.closed) return
    this.pending = { ...this.pending, ...patch }
    this.options.write(this.pending)
    void this.flush()
  }

  close() {
    this.closed = true
  }

  private flush() {
    if (this.saving || !this.hydrated || !this.online || this.closed || !Object.keys(this.pending).length) return
    this.saving = true
    const sent = { ...this.pending }

    void this.options.save(sent).then(
      () => {
        if (this.closed) return
        if (sent.language === this.pending.language) delete this.pending.language
        if (sent.theme === this.pending.theme) delete this.pending.theme
        this.options.write(this.pending)
        this.options.error("")
        this.saving = false
        this.flush()
      },
      () => {
        this.saving = false
        if (!this.closed) this.options.error(ErrorCode.PREFERENCES_SAVE_FAILED)
      },
    )
  }
}
