export interface RelayConfig {
  databaseUrl: string;
  redisUrl?: string;
  schema?: string;
  botToken: string;
  botUsername?: string;
  publicOrigin: string;
  inputEnabled?: boolean;
  permissionsEnabled?: boolean;
  staticDirectory?: string;
}

export const RELAY_CONFIG = Symbol('RELAY_CONFIG');

/** Provides `Messaging | undefined` (see `infrastructure/messaging.ts`): undefined when the relay runs without Redis. */
export const MESSAGING = Symbol('MESSAGING');
