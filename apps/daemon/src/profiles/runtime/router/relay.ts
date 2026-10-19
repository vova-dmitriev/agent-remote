import {
  FrameType,
  ErrorCode,
  knownErrorCode,
  ProfileLimits,
  type ServerFrame,
  type DeviceFrame,
} from '@protocol';
import type { RuntimeProfiles } from '../service.js';

type ProfileRelayFrame = Extract<
  ServerFrame,
  { type: typeof FrameType.ProfilesRequest | typeof FrameType.ProfilesCancel }
>;

export class RuntimeProfileRelay {
  private active = new Map<string, AbortController>();

  constructor(
    private service: RuntimeProfiles,
    private epoch: () => string | undefined,
    private send: (frame: DeviceFrame) => boolean,
  ) {}

  async receive(frame: ProfileRelayFrame) {
    if (this.epoch() !== frame.epoch) {
      return;
    }

    if (frame.type === FrameType.ProfilesCancel) {
      this.active.get(frame.requestId)?.abort();

      return;
    }

    if (this.active.has(frame.requestId)) {
      return;
    }

    if (this.active.size >= 8) {
      this.send({
        type: FrameType.ProfilesResult,
        requestId: frame.requestId,
        epoch: frame.epoch,
        reply: { ok: false, code: ErrorCode.QUEUE_FULL },
      });

      return;
    }

    const controller = new AbortController();

    this.active.set(frame.requestId, controller);
    const current = () => !controller.signal.aborted && this.epoch() === frame.epoch;

    try {
      const response = await this.service.request(frame.request, current);

      if (current()) {
        if (Buffer.byteLength(JSON.stringify(response)) > ProfileLimits.ResponseBytes) {
          throw new Error(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
        }

        this.send({
          type: FrameType.ProfilesResult,
          requestId: frame.requestId,
          epoch: frame.epoch,
          reply: { ok: true, response },
        });
      }
    } catch (error) {
      if (current()) {
        this.send({
          type: FrameType.ProfilesResult,
          requestId: frame.requestId,
          epoch: frame.epoch,
          reply: { ok: false, code: knownErrorCode(error) },
        });
      }
    } finally {
      this.active.delete(frame.requestId);
    }
  }

  disconnect() {
    for (const controller of this.active.values()) {
      controller.abort();
    }

    this.active.clear();
  }
}
