import type { Readable, Writable } from 'node:stream';
import type { z } from 'zod';
import type { browserSettingsSchema } from '../../local/bootstrap/configuration.js';
import type { ensureCompanion } from '../../local/supervisor/index.js';
import type { probeCompanion } from '../../local/bootstrap/probe.js';
import type { runNativeHost } from '../../browser/host/bridge.js';

export type BrowserSettings = z.infer<typeof browserSettingsSchema>;
export interface BrowserCliDependencies {
  startDaemon?: (options: { legacyClaudeHooks: boolean }) => Promise<{ close: () => Promise<void> }>;
  onShutdown?: (callback: () => void) => void;
  bridge?: typeof runNativeHost;
  ensure?: typeof ensureCompanion;
  probe?: typeof probeCompanion;
}
export interface BrowserCliOptions {
  directory?: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  input?: Readable;
  output?: Writable;
  dependencies?: BrowserCliDependencies;
}
export interface BrowserCliContext extends BrowserCliOptions {
  directory: string;
  output: Writable;
}
