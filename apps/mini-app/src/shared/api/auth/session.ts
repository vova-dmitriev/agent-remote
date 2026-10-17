import { ErrorCode } from "@protocol"
import { fetchResponse, responseError } from "../request-error"

type Login = { token: string; expiresAt: number }

export class SessionAuthentication {
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<void> | undefined
  private request = new AbortController()

  constructor(
    private origin: string,
    private accept: (login: Login) => void,
    private failed: (error: Error) => void,
  ) {}

  private async load(path: string, body?: unknown): Promise<Login> {
    const response = await fetchResponse(this.origin + path, {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.any([this.request.signal, AbortSignal.timeout(10000)]),
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    if (!response.ok) throw await responseError(response)
    const value = (await response.json()) as Login

    if (typeof value.token !== "string" || !value.token || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now())
      throw new Error(ErrorCode.TELEGRAM_AUTH_FAILED)

    return value
  }

  async start(initData: string) {
    const login = await this.load("/auth/telegram", { initData }).catch((error: unknown) => {
      if (error instanceof Error && [ErrorCode.UNAUTHORIZED, ErrorCode.ACCESS_DENIED].some((candidate) => candidate === error.message))
        return this.load("/auth/refresh", { initData })
      throw error
    })

    this.apply(login)
  }

  private apply(login: Login) {
    if (this.stopped) return
    clearTimeout(this.timer)
    this.accept(login)
    this.timer = setTimeout(() => void this.renew(), Math.max(1000, login.expiresAt - Date.now() - 60000))
  }

  renew() {
    if (this.stopped) return Promise.resolve()
    if (this.pending) return this.pending
    clearTimeout(this.timer)

    this.pending = this.load("/auth/refresh")
      .then((login) => this.apply(login))
      .catch((failure: unknown) => {
        if (this.stopped) return
        const error = failure instanceof Error ? failure : new Error(ErrorCode.NETWORK_UNAVAILABLE)

        this.failed(error)
        if (!this.stopped) this.timer = setTimeout(() => void this.renew(), 15000)
      })
      .finally(() => {
        this.pending = undefined
      })

    return this.pending
  }

  close() {
    this.stopped = true
    clearTimeout(this.timer)
    this.request.abort()
  }
}
