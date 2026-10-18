export const LOCAL_LIMITS = {
  protocolVersion: 1,
  frameBytes: 512 * 1024,
  chunkBytes: 256 * 1024,
  logicalBytes: 8 * 1024 * 1024,
  pendingBytes: 16 * 1024 * 1024,
  fragmentExpiryMs: 30_000,
  requestTimeoutMs: 30_000,
  maxPendingRequests: 64,
  maxClients: 32,
  maxTransfers: 16,
  maxGrantRecords: 128,
  maxCommandIntents: 10000,
  pendingGrantExpiryMs: 5 * 60_000,
  queueLimit: 20,
} as const;

export const NATIVE_HOST_NAME = 'com.agent_remote.companion';
