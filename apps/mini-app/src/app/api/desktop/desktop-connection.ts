import {
  ErrorCode,
  DesktopBridgeKind,
  DesktopBridgeVersion,
  desktopBridgeEventSchema,
  desktopBridgeLeaseSchema,
  desktopBridgeRequestSchema,
  desktopBridgeResultSchema,
  type DesktopBridge,
  type DesktopBridgeEvent,
  type LocalAction,
} from "@protocol"

/** Internal transport adapter. Callers validate operation results before exposing them as app data. */
export class DesktopBridgeConnection {
  private lease: ReturnType<typeof desktopBridgeLeaseSchema.parse> | null = null
  private generation = 0
  private release: (() => void) | null = null
  private opening = false
  private early: DesktopBridgeEvent[] = []
  private listeners = new Set<(event: DesktopBridgeEvent) => void>()

  constructor(private readonly bridge: DesktopBridge) {}

  async start(): Promise<void> {
    if (!this.release) {
      this.release = this.bridge.subscribe(this.receive)
    }

    await this.open()
  }

  async reconnect(): Promise<void> {
    const previous = this.lease

    this.lease = null
    ++this.generation

    if (previous) await this.bridge.close(previous.leaseId, previous.epoch)

    await this.open()
  }

  async request(action: LocalAction): Promise<unknown> {
    const lease = this.lease

    if (!lease) throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE)

    const generation = this.generation

    const request = desktopBridgeRequestSchema.parse({
      kind: DesktopBridgeKind.Request,
      version: DesktopBridgeVersion.V1,
      requestId: globalThis.crypto.randomUUID(),
      leaseId: lease.leaseId,
      epoch: lease.epoch,
      action,
    })

    const result = desktopBridgeResultSchema.parse(await this.bridge.request(request))

    if (
      generation !== this.generation ||
      this.lease !== lease ||
      result.requestId !== request.requestId ||
      result.leaseId !== lease.leaseId ||
      result.epoch !== lease.epoch
    ) {
      throw new Error(ErrorCode.STALE_SESSION)
    }

    if (!result.ok) throw new Error(result.code)

    return result.data
  }

  subscribe(listener: (event: DesktopBridgeEvent) => void): () => void {
    this.listeners.add(listener)

    return () => this.listeners.delete(listener)
  }

  async close(): Promise<void> {
    ++this.generation
    this.release?.()
    this.release = null
    this.listeners.clear()

    const lease = this.lease

    this.lease = null

    if (lease) await this.bridge.close(lease.leaseId, lease.epoch)
  }

  private open = async (): Promise<void> => {
    const generation = this.generation

    this.opening = true
    this.early = []

    let lease: ReturnType<typeof desktopBridgeLeaseSchema.parse>

    try {
      lease = desktopBridgeLeaseSchema.parse(await this.bridge.open())
    } finally {
      this.opening = false
    }

    const early = this.early

    this.early = []

    if (generation !== this.generation) {
      await this.bridge.close(lease.leaseId, lease.epoch)

      return
    }

    this.lease = lease

    for (const event of early) this.receive(event)
  }

  private receive = (raw: DesktopBridgeEvent): void => {
    const parsed = desktopBridgeEventSchema.safeParse(raw)
    const lease = this.lease

    // The host replays its initial snapshot while the lease is opening; keep it until the lease is known.
    if (parsed.success && !lease && this.opening) this.early.push(parsed.data)

    if (!parsed.success || !lease || parsed.data.leaseId !== lease.leaseId || parsed.data.epoch !== lease.epoch) {
      return
    }

    for (const listener of this.listeners) listener(parsed.data)
  }
}
