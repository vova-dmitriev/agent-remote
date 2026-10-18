import { ErrorCode, FrameType, type ServerFrame } from '../../../../../packages/protocol/src/index.js';
import { Fault } from '../../auth/security.js';
import type { PendingProfileRequest, ProfileConnection } from '../types.js';

export class ProfileRequestRegistry extends Map<string, PendingProfileRequest> {
  constructor(
    private live: Map<string, ProfileConnection>,
    private send: (socket: ProfileConnection['socket'], frame: ServerFrame) => boolean,
  ) {
    super();
  }

  take(id: string) {
    const pending = this.get(id);

    this.delete(id);

    if (pending) {
      clearTimeout(pending.timer);
    }

    return pending;
  }

  cancel(id: string, code: ErrorCode) {
    const pending = this.take(id);

    if (!pending) {
      return;
    }

    if (this.live.get(pending.deviceId) === pending.connection) {
      this.send(pending.connection.socket, {
        type: FrameType.ProfilesCancel,
        requestId: id,
        epoch: pending.connection.epoch,
      });
    }

    pending.reject(new Fault(code, 409));
  }

  cancelAuth(keys: readonly string[]) {
    const revoked = new Set(keys);

    for (const [id, pending] of this) {
      if (revoked.has(pending.authKey)) {
        this.cancel(id, ErrorCode.UNAUTHORIZED);
      }
    }
  }

  disconnect(connection: ProfileConnection) {
    for (const [id, pending] of this) {
      if (pending.connection === connection) {
        this.cancel(id, ErrorCode.DEVICE_OFFLINE);
      }
    }
  }

  close() {
    for (const id of this.keys()) {
      this.cancel(id, ErrorCode.DEVICE_OFFLINE);
    }
  }
}
