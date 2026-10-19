// Shared by the e2e relay child process (relay-entry.ts) and the Playwright side (relay-process.ts).
// Test-only: production code never mounts this channel.

export const RELAY_CONFIG_ENV = 'E2E_RELAY_CONFIG';
export const RELAY_READY_PREFIX = 'E2E_RELAY_READY ';
export const CONTROL_TOKEN_HEADER = 'x-e2e-control-token';

export const RelayControlMethod = {
  Login: 'auth.login',
  Authenticate: 'auth.authenticate',
  PairStart: 'devices.start',
  PairClaim: 'devices.claim',
  PairConfirm: 'devices.confirm',
  PairStatus: 'devices.status',
  DeviceOwned: 'devices.owned',
  Command: 'command',
  LiveHas: 'live.has',
  StoreAttachment: 'attachments.store',
  BotUpdates: 'notifications.updates',
  DeliverNotification: 'notifications.deliver',
} as const;

export type RelayControlMethod = (typeof RelayControlMethod)[keyof typeof RelayControlMethod];

export interface RelayProcessConfig {
  databaseUrl: string;
  schema: string;
  publicOrigin: string;
  port: number;
  inputEnabled: boolean;
  permissionsEnabled: boolean;
  controlToken: string;
}

export interface RelayReady {
  origin: string;
  control: string;
}

export interface ControlRequest {
  method: RelayControlMethod;
  args: unknown[];
}

export type ControlResponse = { value: unknown } | { error: { code?: string | undefined; message: string } };

const BYTES_KEY = '$bytes';

// Buffers and byte arrays cross the channel as base64 and come back as Buffers.
export const encodeControl = (value: unknown) =>
  JSON.stringify(value, function (key, item: unknown) {
    const raw: unknown = (this as Record<string, unknown>)[key];

    return raw instanceof Uint8Array ? { [BYTES_KEY]: Buffer.from(raw).toString('base64') } : item;
  });

export const decodeControl = (text: string): unknown =>
  JSON.parse(text, (_key, item: unknown) =>
    item && typeof item === 'object' && BYTES_KEY in item
      ? Buffer.from(String((item as Record<string, unknown>)[BYTES_KEY]), 'base64')
      : item,
  );
