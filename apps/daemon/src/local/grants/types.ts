import type { LocalClientGrant, LocalGrantStatus } from '../../../../../packages/protocol/src/index.js';

export interface GrantRow {
  client: string;
  origin: string;
  status: LocalGrantStatus;
  token_hash: string | null;
  expires_at: number;
}

export interface LocalPrincipal extends LocalClientGrant {
  clientId: string;
  origin: string;
}
