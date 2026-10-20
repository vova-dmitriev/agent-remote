import {
  CommandStatus,
  type PromptDelivery,
  EventType,
  CapabilityKey,
  IntegrationState,
  targetSchema,
  type Target,
  type ConnectorDescriptor,
  ConnectorTransport,
  type Session,
} from '@protocol';
import { type PreparedAttachment } from '../attachments/types.js';
import type { Binding } from '../domain/ports/binding.js';

export class AdapterError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export type { Binding };
export interface DispatchReceipt {
  status: typeof CommandStatus.Dispatched | typeof CommandStatus.Unknown;
  code?: string;
}
export interface ProviderEvent {
  sessionId: string;
  type:
    | typeof EventType.Message
    | typeof EventType.Status
    | typeof EventType.Tool
    | typeof EventType.Snapshot
    | typeof EventType.Permission
    | typeof EventType.BindingLost;
  occurredAt: number;
  payload: unknown;
}
export interface SessionAdapter {
  descriptor(): ConnectorDescriptor;
  discover(): Promise<Binding[]>;
  observe(binding: Binding): AsyncIterable<ProviderEvent>;
  sendPrompt(
    binding: Binding,
    text: string,
    attachments?: readonly PreparedAttachment[],
    delivery?: PromptDelivery,
  ): Promise<DispatchReceipt>;
  interrupt(binding: Binding): Promise<DispatchReceipt>;
  close(): Promise<void>;
}
type Driver = {
  prompt?: (
    binding: Binding,
    text: string,
    attachments?: readonly PreparedAttachment[],
    delivery?: PromptDelivery,
  ) => Promise<DispatchReceipt>;
  interrupt?: (binding: Binding) => Promise<DispatchReceipt>;
  screen?: (binding: Binding) => Promise<string>;
};
export class SourceAdapter implements SessionAdapter {
  private bindings = new Map<string, Binding>();
  constructor(
    private description: ConnectorDescriptor,
    private driver: Driver = {},
  ) {}
  descriptor() {
    return structuredClone(this.description);
  }
  bind(binding: Binding) {
    this.bindings.set(JSON.stringify(binding.target), structuredClone(binding));
  }
  unbind(target: Target) {
    this.bindings.delete(JSON.stringify(target));
  }
  async discover() {
    return [...this.bindings.values()].map((b) => structuredClone(b));
  }
  async *observe(_binding: Binding): AsyncIterable<ProviderEvent> {
    /* hooks are pushed to Monitor by authenticated IPC */
  }
  async sendPrompt(
    binding: Binding,
    text: string,
    attachments?: readonly PreparedAttachment[],
    delivery?: PromptDelivery,
  ) {
    this.check(binding, CapabilityKey.Prompt);

    if (attachments?.length && !this.description.capabilities.attachments) {
      throw new AdapterError('CAPABILITY_UNAVAILABLE');
    }

    if (!this.driver.prompt) {
      throw new AdapterError('CAPABILITY_UNAVAILABLE');
    }

    return this.driver.prompt(binding, text, attachments, delivery);
  }
  async interrupt(binding: Binding) {
    this.check(binding, CapabilityKey.Interrupt);

    if (!this.driver.interrupt) {
      throw new AdapterError('CAPABILITY_UNAVAILABLE');
    }

    return this.driver.interrupt(binding);
  }
  async readScreen(binding: Binding) {
    const current = this.bindings.get(JSON.stringify(binding.target));

    if (!this.description.capabilities.terminalSnapshot || !this.driver.screen) {
      throw new AdapterError('CAPABILITY_UNAVAILABLE');
    }

    if (!current || current.generation !== binding.generation || current.localProof !== binding.localProof) {
      throw new AdapterError('STALE_SESSION');
    }

    return this.driver.screen(binding);
  }
  async close() {
    this.bindings.clear();
    this.description = { ...this.description, state: IntegrationState.Disconnected };
  }
  private check(binding: Binding, capability: typeof CapabilityKey.Prompt | typeof CapabilityKey.Interrupt) {
    const current = this.bindings.get(JSON.stringify(binding.target));

    if (!this.description.capabilities[capability]) {
      throw new AdapterError('CAPABILITY_UNAVAILABLE');
    }

    if (!current || current.localProof !== binding.localProof || current.generation !== binding.generation) {
      throw new AdapterError('STALE_SESSION');
    }
  }
}
export class AdapterRegistry {
  private adapters = new Map<string, SessionAdapter>();
  constructor(private deviceId: string) {}
  deviceIdentity() {
    return this.deviceId;
  }
  register(adapter: SessionAdapter) {
    const descriptor = adapter.descriptor();

    if (
      this.adapters.get(descriptor.connectorId)?.descriptor().state !== undefined &&
      this.adapters.get(descriptor.connectorId)!.descriptor().state !== IntegrationState.Disconnected
    ) {
      throw new AdapterError('CONNECTOR_EXISTS');
    }

    for (const [id, existing] of this.adapters) {
      if (id !== descriptor.connectorId && existing.descriptor().state === IntegrationState.Disconnected) {
        this.adapters.delete(id);
      }
    }

    this.adapters.set(descriptor.connectorId, adapter);
  }
  resolve(input: Target) {
    const target = targetSchema.parse(input);
    const adapter = this.adapters.get(target.connectorId);

    if (
      target.deviceId !== this.deviceId ||
      !adapter ||
      adapter.descriptor().kind !== target.kind ||
      adapter.descriptor().state === IntegrationState.Disconnected
    ) {
      throw new AdapterError('NOT_FOUND');
    }

    return adapter;
  }
  get(connectorId: string) {
    return this.adapters.get(connectorId);
  }
  /**
   * Connector descriptors; given the sessions, a cmux surface's connector only while a session runs there, since a
   * closed tab leaves its connector behind.
   */
  list(sessions?: readonly Session[]) {
    return [...this.adapters.values()]
      .map((adapter) => adapter.descriptor())
      .filter(
        (descriptor) =>
          !sessions ||
          descriptor.transport !== ConnectorTransport.Cmux ||
          sessions.some((session) => session.target.connectorId === descriptor.connectorId),
      );
  }
  async disconnect(connectorId: string) {
    await this.adapters.get(connectorId)?.close();
  }
  async close() {
    await Promise.all([...this.adapters.values()].map((adapter) => adapter.close()));
  }
}
