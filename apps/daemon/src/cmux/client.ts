import {
  TargetKind,
  positiveInteger,
  truncateUtf8,
  validatePrompt,
  type CmuxTarget,
} from '../../../../packages/protocol/src/index.js';
import { execFile } from 'node:child_process';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A local CLI adapter; ownership/authentication belongs to the calling daemon. */
export class CmuxClient {
  private readonly executable: string;
  private readonly timeoutMs: number;
  constructor(options: { executable?: string; timeoutMs?: number } = {}) {
    this.executable = options.executable ?? TargetKind.Cmux;
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 5_000, 'CMUX_TIMEOUT');
  }

  async readScreen(target: CmuxTarget): Promise<string> {
    const text = await this.run(['read-screen', ...this.selectors(target), '--lines', '200']);

    return truncateUtf8(text, 65_536);
  }

  async pasteAndSubmit(target: CmuxTarget, text: string): Promise<void> {
    validatePrompt(text);
    // stdin keeps text beginning with '-' out of the CLI option parser.
    await this.run(['paste', ...this.selectors(target), '--submit', '-'], text);
  }

  async sendEscape(target: CmuxTarget): Promise<void> {
    await this.run(['send-key', ...this.selectors(target), 'Escape']);
  }

  private selectors(target: CmuxTarget): string[] {
    if (
      !target ||
      target.kind !== TargetKind.Cmux ||
      ![target.deviceId, target.connectorId].every(
        (value) => typeof value === 'string' && value.length > 0 && value.length <= 512,
      ) ||
      ![target.windowId, target.workspaceId, target.surfaceId].every(
        (value) => typeof value === 'string' && uuid.test(value),
      )
    ) {
      throw new Error('INVALID_CMUX_TARGET');
    }

    return ['--window', target.windowId, '--workspace', target.workspaceId, '--surface', target.surfaceId];
  }

  private run(args: string[], input = ''): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        this.executable,
        args,
        {
          encoding: 'utf8',
          timeout: this.timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: 131_072,
          shell: false,
        },
        (error, stdout) => {
          // CLI stderr may contain terminal/chat content; do not include it in errors.
          if (error) {
            reject(new Error('CMUX_COMMAND_FAILED', { cause: { code: error.code, killed: error.killed } }));
          } else {
            resolve(stdout);
          }
        },
      );

      child.stdin?.on('error', () => {
        /* Early exit/EPIPE is handled by execFile's completion. */
      });

      child.stdin?.end(input);
    });
  }
}
