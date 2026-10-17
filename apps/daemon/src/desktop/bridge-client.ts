import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

export function installationRoot() {
  let directory = dirname(fileURLToPath(import.meta.url));

  while (directory !== parse(directory).root) {
    const path = join(directory, 'package.json');

    if (existsSync(path)) {
      try {
        if ((JSON.parse(readFileSync(path, 'utf8')) as { name: string }).name === 'claude-remote') {
          return directory;
        }
      } catch {}
    }

    directory = dirname(directory);
  }

  throw new Error('INSTALLATION_ROOT_NOT_FOUND');
}

export class BridgeClient {
  private process: ReturnType<typeof spawn> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private pending:
    | {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  private buffer = Buffer.alloc(0);
  constructor(
    private executable = process.env.CLAUDE_REMOTE_HELPER ??
      join(installationRoot(), 'artifacts/ClaudeRemoteBridge.app/Contents/MacOS/ClaudeBridge'),
  ) {}
  request(value: unknown): Promise<unknown> {
    const result = this.queue.catch(() => {}).then(() => this.execute(value));

    this.queue = result;

    return result;
  }
  private execute(value: unknown): Promise<unknown> {
    if (!this.process) {
      this.process = spawn(this.executable, [], { stdio: ['pipe', 'pipe', 'ignore'] });
      const child = this.process;

      child.on('error', () => {
        if (this.process === child) {
          this.fail('HELPER_UNAVAILABLE');
          this.close();
        }
      });

      child.stdin!.on('error', () => {
        if (this.process === child) {
          this.fail('HELPER_EXITED');
        }
      });

      child.on('exit', () => {
        if (this.process !== child) {
          return;
        }

        this.process = undefined;
        this.fail('HELPER_EXITED');
      });

      child.stdout!.on('data', (chunk: Buffer) => {
        if (this.process !== child) {
          return;
        }

        this.buffer = Buffer.concat([this.buffer, chunk]);

        if (this.buffer.length > 131072) {
          this.fail('HELPER_FRAME_TOO_LARGE');
          this.close();

          return;
        }

        const newline = this.buffer.indexOf(10);

        if (newline === -1) {
          return;
        }

        const line = this.buffer.subarray(0, newline);

        this.buffer = Buffer.from(this.buffer.subarray(newline + 1));

        try {
          const response = JSON.parse(line.toString('utf8'));
          const pending = this.pending;

          if (!pending) {
            return;
          }

          this.pending = undefined;
          clearTimeout(pending.timer);

          if (response.ok) {
            pending.resolve(response.result);
          } else {
            pending.reject(new Error(typeof response.code === 'string' ? response.code : 'HELPER_FAILED'));
          }
        } catch {
          this.fail('INVALID_HELPER_FRAME');
        }
      });
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail('HELPER_TIMEOUT');
        this.close();
      }, 3000);

      this.pending = { resolve, reject, timer };
      this.process!.stdin!.write(JSON.stringify(value) + '\n');
    });
  }
  private fail(code: string) {
    if (this.pending) {
      const pending = this.pending;

      this.pending = undefined;
      clearTimeout(pending.timer);
      pending.reject(new Error(code));
    }
  }
  close() {
    this.fail('HELPER_CLOSED');
    this.process?.kill('SIGKILL');
    this.process = undefined;
    this.buffer = Buffer.alloc(0);
  }
}
