import {
  DesktopBridgeError,
  DesktopBridgeChannel,
  DesktopBridgeKind,
  DesktopBridgeVersion,
  LOCAL_LIMITS,
  desktopBridgeLeaseSchema,
  type DesktopBridgeEvent,
  type DesktopBridgeLease,
  type ServerFrame,
  serverFrameSchema,
} from '@protocol';
import { randomUUID } from 'node:crypto';
import type { DesktopCompanionConnector } from './companion-port.js';
import type { DesktopWindowPort } from './ipc/ipc.js';

export interface ActiveDesktopLease {
  lease: DesktopBridgeLease;
  sequence: number;
  pendingBytes: number;
  queue: Array<{ frame: ServerFrame; bytes: number }>;
  awaitingAck: DesktopBridgeEvent | null;
  awaitingBytes: number;
  pendingRequests: number;
  subscription: () => void;
  aborters: Set<AbortController>;
}

export class DesktopEventDelivery {
  private active: ActiveDesktopLease | null = null;

  constructor(
    private readonly currentWindow: () => DesktopWindowPort | null,
    private readonly connector: DesktopCompanionConnector,
  ) {}

  get lease(): ActiveDesktopLease | null {
    return this.active;
  }

  open(epoch: number): DesktopBridgeLease {
    this.revoke();

    const lease = desktopBridgeLeaseSchema.parse({
      leaseId: randomUUID(),
      epoch,
    });

    const current: ActiveDesktopLease = {
      lease,
      sequence: 0,
      pendingBytes: 0,
      queue: [],
      awaitingAck: null,
      awaitingBytes: 0,
      pendingRequests: 0,
      aborters: new Set(),
      subscription: () => {},
    };

    this.active = current;
    current.subscription = this.connector.subscribe((frame) => this.enqueue(frame));

    return lease;
  }

  revoke(): void {
    const previous = this.active;

    if (!previous) {
      return;
    }

    this.active = null;
    previous.subscription();
    previous.aborters.forEach((aborter) => aborter.abort());
    previous.queue = [];
    previous.pendingBytes = 0;
    previous.awaitingAck = null;
    previous.awaitingBytes = 0;
  }

  acknowledge(lease: { leaseId: string; epoch: number; sequence: number }): void {
    const active = this.active;

    if (
      !active ||
      !sameDesktopLease(active.lease, lease) ||
      active.awaitingAck?.sequence !== lease.sequence
    ) {
      throw new Error(DesktopBridgeError.Unavailable);
    }

    active.pendingBytes -= active.awaitingBytes;
    active.awaitingBytes = 0;
    active.awaitingAck = null;
    this.sendNext();
  }

  private enqueue(rawFrame: ServerFrame): void {
    const active = this.active;

    if (!active) {
      return;
    }

    const parsed = serverFrameSchema.safeParse(rawFrame);

    if (!parsed.success) {
      this.revoke();

      return;
    }

    let bytes: number;

    try {
      bytes = Buffer.byteLength(JSON.stringify(parsed.data));
    } catch {
      this.revoke();

      return;
    }

    if (
      bytes > LOCAL_LIMITS.frameBytes ||
      active.queue.length >= LOCAL_LIMITS.maxPendingRequests ||
      active.pendingBytes + bytes > LOCAL_LIMITS.pendingBytes
    ) {
      this.revoke();

      return;
    }

    active.queue.push({ frame: parsed.data, bytes });
    active.pendingBytes += bytes;
    this.sendNext();
  }

  private sendNext(): void {
    const active = this.active;

    if (!active || active.awaitingAck || !active.queue.length) {
      return;
    }

    const window = this.currentWindow();

    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      this.revoke();

      return;
    }

    const queued = active.queue.shift()!;

    const event: DesktopBridgeEvent = {
      kind: DesktopBridgeKind.Event,
      version: DesktopBridgeVersion.V1,
      leaseId: active.lease.leaseId,
      epoch: active.lease.epoch,
      sequence: ++active.sequence,
      frame: queued.frame,
    };

    active.awaitingBytes = queued.bytes;
    active.awaitingAck = event;
    window.webContents.send(DesktopBridgeChannel.Event, event);
  }
}

export function sameDesktopLease(
  lease: DesktopBridgeLease,
  other: { leaseId: string; epoch: number },
): boolean {
  return lease.leaseId === other.leaseId && lease.epoch === other.epoch;
}
