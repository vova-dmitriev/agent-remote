import { ConnectionStatus, FrameType, SocketCloseCode, serverFrameSchema, type HistoryPageDirection } from "@protocol"
import {
  SessionAuthentication,
  createAppSocket,
  isAuthenticationError,
  logoutSession,
  requestJson,
  startSessionAuthentication,
  type ApplicationClient,
  type TransportHandlers,
} from "@/shared/api"
import { AttachmentTransfer } from "@/entities/attachment"
import {
  HistoryStream,
  HistoryWindow,
  ReadingPositions,
  SubagentHistory,
  loadSessionHistory,
  restoreHistoryWindow,
} from "@/entities/session"
import { appReconnectBackoff } from "./reconnect-policy"
import { RelayOperations } from "./relay-operations"

export class AppTransport extends RelayOperations implements ApplicationClient {
  private token = ""
  private socket: WebSocket | undefined
  private stopped = false
  private expiresAt = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private backoff = appReconnectBackoff()
  private authentication: SessionAuthentication
  private deviceId: string | null = null
  private selectedId: string | null = null
  private selection = 0
  private historyStream = new HistoryStream()
  private window = new HistoryWindow()
  private subagents = new SubagentHistory((path, observe) => this.request(path, {}, observe), this.historyStream)
  private reading = new ReadingPositions(this)
  private restoreHistory: number | null = null
  private requests = new Set<AbortController>()
  readonly attachments = new AttachmentTransfer(() => ({ origin: this.origin, token: this.token }), this.requests)
  constructor(
    private initData: string,
    private handlers: TransportHandlers,
    private origin = "",
  ) {
    super()

    this.authentication = new SessionAuthentication(
      origin,
      (login) => {
        if (this.stopped) return
        this.token = login.token
        this.expiresAt = login.expiresAt
        const previous = this.socket

        this.connect()
        previous?.close()
      },
      (error) => {
        const expired = isAuthenticationError(error)

        this.handlers.onConnection(expired ? ConnectionStatus.Expired : ConnectionStatus.Offline)
        if (expired) this.close()
      },
    )
  }
  start() {
    return startSessionAuthentication(this.authentication, this.initData, this.handlers)
  }
  private connect() {
    if (this.stopped) return

    if (Date.now() >= this.expiresAt) {
      void this.authentication.renew()

      return
    }

    clearTimeout(this.retry)
    const socket = createAppSocket(this.origin, () => this.token)

    this.socket = socket

    socket.onmessage = (event) => {
      if (this.stopped || socket !== this.socket) return

      try {
        const frame = serverFrameSchema.parse(JSON.parse(String(event.data)))

        if (frame.type === FrameType.Authenticated) {
          this.backoff.authenticated()
          this.handlers.onConnection(ConnectionStatus.Online)
          if (this.deviceId) this.selectTarget(this.deviceId, this.selectedId)
          this.restoreHistory = this.selectedId ? this.selection : null
        }

        if (frame.type === FrameType.CommandResult) frame.result = this.commands.observe(frame.result)
        this.handlers.onFrame(frame)

        const streamChanged = frame.type === FrameType.Snapshot && this.historyStream.changed(frame)

        if (frame.type === FrameType.Snapshot && (this.restoreHistory === this.selection || streamChanged) && this.selectedId) {
          if (streamChanged) ++this.selection
          this.restoreHistory = null
          const selected = this.selectedId
          const generation = this.selection
          const current = () => this.currentHistory(socket, selected, generation)

          void restoreHistoryWindow(selected, this.history(selected), current, this.handlers)
        }
      } catch {
        socket.close()
      }
    }

    socket.onclose = (event) => {
      if (this.stopped || socket !== this.socket) return
      this.handlers.onConnection(ConnectionStatus.Offline)
      if (event.code === SocketCloseCode.Unauthorized || Date.now() >= this.expiresAt) void this.authentication.renew()
      else this.retry = setTimeout(() => this.connect(), this.backoff.next())
    }
  }
  async request<T>(path: string, options: RequestInit = {}, onResponse?: (response: Response) => void): Promise<T> {
    return requestJson<T>(
      this.origin + path,
      { ...options, headers: { "content-type": "application/json", authorization: `Bearer ${this.token}`, ...options.headers } },
      this.requests,
      onResponse,
    )
  }
  profiles = (deviceId: string) => this.profileAccess(deviceId, () => !this.stopped)
  profileRouting = (deviceId: string) => this.routingAccess(deviceId, () => !this.stopped)
  continuity(deviceId: string) {
    const selection = this.selection

    return this.continuityAccess(deviceId, () => !this.stopped && this.deviceId === deviceId && this.selection === selection)
  }
  selectTarget(deviceId: string, sessionId: string | null) {
    this.reading.flush()
    ++this.selection
    this.deviceId = deviceId
    this.selectedId = sessionId
    this.window.reset()
    this.subagents.reset()
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: FrameType.Subscribe, deviceId, sessionId }))
  }
  resetTarget() {
    ++this.selection
    this.deviceId = this.selectedId = null
    this.resetCommands()
  }
  private currentHistory = (socket: WebSocket | undefined, sessionId: string, generation: number) =>
    !this.stopped && socket === this.socket && sessionId === this.selectedId && generation === this.selection
  history(sessionId: string, latest = false) {
    if (latest) {
      ++this.selection
      this.window.reset()
    }

    const generation = this.selection
    const socket = this.socket

    return loadSessionHistory(
      sessionId,
      (path, observe) => this.request(path, {}, observe),
      () => this.currentHistory(socket, sessionId, generation),
      (status) => this.handlers.onHistoryStatus?.(sessionId, status),
      latest
        ? ""
        : () => this.reading.query(this.deviceId + ":" + sessionId, sessionId, () => this.currentHistory(socket, sessionId, generation)),
      this.window.observe,
    )
  }
  async historyPage(sessionId: string, direction: HistoryPageDirection, edge?: string) {
    const socket = this.socket,
      generation = this.selection

    return this.window.page(
      direction,
      (query, observe) => this.request("/sessions/" + encodeURIComponent(sessionId) + "/events" + query, {}, observe),
      () => this.currentHistory(socket, sessionId, generation),
      edge,
    )
  }
  subagentHistory: NonNullable<ApplicationClient["subagentHistory"]> = (sessionId, agentId, direction, edge) =>
    this.subagents.page(sessionId, agentId, direction, () => !this.stopped && this.selectedId === sessionId, edge)
  logout = () => logoutSession(this)
  close() {
    this.stopped = true
    clearTimeout(this.retry)
    this.backoff.reset()
    this.authentication.close()
    this.reading.close()
    this.socket?.close()
    this.token = ""
    for (const request of this.requests) request.abort()
    this.requests.clear()
  }
}
