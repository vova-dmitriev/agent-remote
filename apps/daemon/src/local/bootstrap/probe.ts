import { connect } from 'node:net';
import { z } from 'zod';
import { CodedError, ErrorCode, LOCAL_LIMITS, LocalControl, LocalFeature } from '@protocol';
import { FramedPeer } from '../../browser/transport/peer.js';

const healthSchema = z.strictObject({
  protocolVersion: z.number().int(),
  instanceId: z.string().min(1).max(512),
  features: z.array(z.string()).optional(),
});

export function probeCompanion(
  path: string,
  capability: string,
  featureRequest?: typeof LocalFeature.DesktopGrants,
): Promise<z.infer<typeof healthSchema> | null> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let peer: FramedPeer | undefined;
    let settled = false;

    const timer = setTimeout(
      () => finish(new CodedError(ErrorCode.LOCAL_COMPANION_TIMEOUT)),
      Math.min(2000, LOCAL_LIMITS.requestTimeoutMs),
    );

    const finish = (error?: Error, value: z.infer<typeof healthSchema> | null = null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      peer?.close();
      socket.destroy();

      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
        finish();
      } else {
        finish(new CodedError(ErrorCode.LOCAL_COMPANION_MISMATCH));
      }
    });

    socket.once('connect', () => {
      peer = new FramedPeer(socket, socket, (raw) => {
        const result = healthSchema.safeParse(raw);

        if (
          !result.success ||
          (featureRequest !== undefined && !result.data.features?.includes(featureRequest))
        ) {
          finish(new CodedError(ErrorCode.LOCAL_COMPANION_MISMATCH));
        } else {
          finish(undefined, result.data);
        }
      });

      void peer
        .send({
          capability,
          control: LocalControl.Health,
          ...(featureRequest ? { featureRequest } : {}),
        })
        .catch(() => finish(new CodedError(ErrorCode.LOCAL_COMPANION_MISMATCH)));

      void peer.closed.then(() => finish(new CodedError(ErrorCode.LOCAL_COMPANION_MISMATCH)));
    });
  });
}
