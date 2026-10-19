import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { CodedError, ErrorCode, LOCAL_LIMITS } from '@protocol';
import { fragmentValue, FragmentReader } from '@transport/native/fragments.js';
import { NativeFrameCodec } from './framing.js';

export class FramedPeer {
  private codec = new NativeFrameCodec();
  private fragments = new FragmentReader();
  private writes: Promise<void> = Promise.resolve();
  private reads: Promise<void> = Promise.resolve();
  private pendingReads = 0;
  private queuedBytes = 0;
  private stopped = false;
  private resolveClosed!: () => void;
  readonly closed = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(
    private input: Readable,
    private output: Writable,
    receive: (value: unknown) => void | Promise<void>,
    observe?: (value: unknown) => void,
  ) {
    input.on('data', (bytes: Buffer) => {
      try {
        for (const frame of this.codec.push(bytes)) {
          const value = this.fragments.accept(frame);

          if (value === undefined) {
            continue;
          }

          if (++this.pendingReads > LOCAL_LIMITS.maxPendingRequests) {
            throw new CodedError(ErrorCode.LOCAL_CLIENT_LIMIT);
          }

          observe?.(value);

          this.reads = this.reads
            .then(async () => {
              if (!this.stopped) {
                await receive(value);
              }
            })
            .catch(() => this.close())
            .finally(() => {
              this.pendingReads--;
            });
        }
      } catch {
        this.close();
      }
    });

    input.on('end', () => this.close());
    input.on('close', () => this.close());
    input.on('error', () => this.close());
    output.on('error', () => this.close());
  }

  send(value: unknown): Promise<void> {
    if (this.stopped) {
      return Promise.reject(new CodedError(ErrorCode.LOCAL_HOST_UNAVAILABLE));
    }

    const frames = fragmentValue(value, randomUUID()).map((fragment) => this.codec.encode(fragment));
    const size = frames.reduce((sum, frame) => sum + frame.length, 0);

    if (size + this.queuedBytes > LOCAL_LIMITS.pendingBytes) {
      this.close();

      return Promise.reject(new CodedError(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE));
    }

    this.queuedBytes += size;

    const result = this.writes
      .then(async () => {
        for (const frame of frames) {
          if (this.stopped) {
            throw new CodedError(ErrorCode.LOCAL_HOST_UNAVAILABLE);
          }

          if (!this.output.write(frame)) {
            await Promise.race([
              once(this.output, 'drain'),
              this.closed.then(() => {
                throw new CodedError(ErrorCode.LOCAL_HOST_UNAVAILABLE);
              }),
            ]);
          }
        }
      })
      .finally(() => {
        this.queuedBytes -= size;
      });

    this.writes = result.catch(() => this.close());

    return result;
  }

  close() {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    this.fragments.clear();
    this.input.destroy();
    this.output.destroy();
    this.resolveClosed();
  }
}
