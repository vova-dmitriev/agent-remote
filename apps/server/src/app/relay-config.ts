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
