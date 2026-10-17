import type { AppTransport } from "@/shared/api"
import type { RuntimeLease } from "./types"

export class TransportRuntime {
  private active: RuntimeLease | null = null
  private generation = 0

  get client() {
    return this.active?.client ?? null
  }

  get epoch() {
    return this.generation
  }

  current() {
    return this.active
  }

  attach(client: AppTransport): RuntimeLease {
    this.active = { client, epoch: ++this.generation }

    return this.active
  }

  isCurrent(lease: RuntimeLease | null) {
    return lease !== null && this.active === lease
  }

  clear(lease?: RuntimeLease) {
    if (lease && !this.isCurrent(lease)) return null
    const client = this.client

    this.active = null
    ++this.generation

    return client
  }
}
