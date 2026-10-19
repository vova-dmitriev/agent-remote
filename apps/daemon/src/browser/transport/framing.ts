import { endianness } from 'node:os';
import { LOCAL_LIMITS, ErrorCode } from '@protocol';

export class NativeFrameCodec {
  private header = Buffer.alloc(4);
  private prefix = 0;
  private body: Buffer | undefined;
  private offset = 0;

  push(input: Uint8Array): unknown[] {
    try {
      return this.read(input);
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  private read(input: Uint8Array): unknown[] {
    const frames: unknown[] = [];
    let consumed = 0;

    while (consumed < input.length) {
      if (!this.body) {
        const count = Math.min(4 - this.prefix, input.length - consumed);

        this.header.set(input.subarray(consumed, consumed + count), this.prefix);
        this.prefix += count;
        consumed += count;

        if (this.prefix !== 4) {
          continue;
        }

        const size = endianness() === 'LE' ? this.header.readUInt32LE() : this.header.readUInt32BE();

        if (size > LOCAL_LIMITS.frameBytes) {
          throw new Error(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
        }

        if (!size) {
          throw new Error(ErrorCode.INVALID_FRAME);
        }

        this.body = Buffer.alloc(size);
        this.offset = 0;
      }

      const count = Math.min(this.body.length - this.offset, input.length - consumed);

      this.body.set(input.subarray(consumed, consumed + count), this.offset);
      this.offset += count;
      consumed += count;

      if (this.offset !== this.body.length) {
        continue;
      }

      try {
        frames.push(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(this.body)));
      } catch {
        throw new Error(ErrorCode.INVALID_FRAME);
      }

      this.reset();
    }

    return frames;
  }

  encode(frame: unknown): Buffer {
    let serialized: string | undefined;

    try {
      serialized = JSON.stringify(frame);
    } catch {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    if (!serialized) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }

    const bytes = Buffer.from(serialized);

    if (bytes.length > LOCAL_LIMITS.frameBytes) {
      throw new Error(ErrorCode.LOCAL_PAYLOAD_TOO_LARGE);
    }

    const header = Buffer.alloc(4);

    if (endianness() === 'LE') {
      header.writeUInt32LE(bytes.length);
    } else {
      header.writeUInt32BE(bytes.length);
    }

    return Buffer.concat([header, bytes]);
  }

  finish() {
    const partial = this.prefix || this.body;

    this.reset();

    if (partial) {
      throw new Error(ErrorCode.INVALID_FRAME);
    }
  }

  private reset() {
    this.body = undefined;
    this.prefix = 0;
    this.offset = 0;
  }
}
