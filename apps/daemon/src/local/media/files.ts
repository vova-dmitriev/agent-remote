import {
  constants,
  chmodSync,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  type Dir,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { MEDIA_ID, MEDIA_LIMITS } from './types.js';
import { ErrorCode, MAX_ATTACHMENT_BYTES } from '@protocol';

export class MediaFiles {
  private staging = new Set<string>();
  private discovery: Dir | undefined;

  constructor(private directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.checkDirectory();
    chmodSync(directory, 0o700);
    this.prune();
  }

  path(id: string, staging = false) {
    this.checkDirectory();

    if (!MEDIA_ID.test(id)) {
      throw new Error(ErrorCode.INVALID_ATTACHMENT);
    }

    return join(this.directory, id + (staging ? '.part' : ''));
  }

  create(id: string) {
    const fd = openSync(
      this.path(id, true),
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );

    closeSync(fd);
    this.staging.add(id);
  }

  append(id: string, offset: number, bytes: Uint8Array) {
    const fd = openSync(this.path(id, true), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);

    try {
      const info = fstatSync(fd);

      this.checkFile(info);

      if (info.size !== offset || offset + bytes.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(ErrorCode.ATTACHMENT_INTEGRITY_FAILED);
      }

      writeSync(fd, bytes);
    } finally {
      closeSync(fd);
    }
  }

  read(id: string, staging = false): Buffer {
    const fd = openSync(this.path(id, staging), constants.O_RDONLY | constants.O_NOFOLLOW);

    try {
      const info = fstatSync(fd);

      this.checkFile(info);

      if (info.size < 1 || info.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(ErrorCode.ATTACHMENT_INTEGRITY_FAILED);
      }

      const bytes = readFileSync(fd);

      if (bytes.length !== info.size) {
        throw new Error(ErrorCode.ATTACHMENT_INTEGRITY_FAILED);
      }

      return bytes;
    } finally {
      closeSync(fd);
    }
  }

  publish(stage: string, id: string) {
    renameSync(this.path(stage, true), this.path(id));
    this.staging.delete(stage);
  }

  remove(id: string, staging = false) {
    rmSync(this.path(id, staging), { force: true });

    if (staging) {
      this.staging.delete(id);
    }
  }

  prune() {
    this.checkDirectory();
    const directory = (this.discovery ??= opendirSync(this.directory));

    for (let checked = 0; checked < MEDIA_LIMITS.discoveryBatch; checked++) {
      const item = directory.readSync();

      if (!item) {
        directory.closeSync();
        this.discovery = undefined;
        break;
      }

      const id = item.name.slice(0, -5);

      if (!item.name.endsWith('.part') || !MEDIA_ID.test(id) || this.staging.has(id)) {
        continue;
      }

      try {
        const info = lstatSync(this.path(id, true));

        this.checkFile(info);

        if (!info.isSymbolicLink() && info.mtimeMs + MEDIA_LIMITS.stageExpiryMs <= Date.now()) {
          this.remove(id, true);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  close() {
    this.discovery?.closeSync();
    this.discovery = undefined;

    for (const id of this.staging) {
      this.remove(id, true);
    }
  }

  private checkDirectory() {
    const info = lstatSync(this.directory);

    if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) {
      throw new Error(ErrorCode.ATTACHMENT_UNAVAILABLE);
    }
  }

  private checkFile(info: ReturnType<typeof fstatSync>) {
    if (!info.isFile() || info.nlink !== 1 || (process.getuid && info.uid !== process.getuid())) {
      throw new Error(ErrorCode.ATTACHMENT_UNAVAILABLE);
    }
  }
}
