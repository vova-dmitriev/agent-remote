import type { WebSocket } from 'ws';
import type { ProfileResponse } from '../../../../packages/protocol/src/index.js';

export interface ProfileConnection {
  socket: WebSocket;
  epoch: string;
  device: { id: string; owner_id: string; generation: string };
}

export interface PendingProfileRequest {
  connection: ProfileConnection;
  authKey: string;
  ownerId: string;
  deviceId: string;
  kind: ProfileResponse['kind'];
  authorize: () => Promise<void>;
  resolve: (result: ProfileResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
