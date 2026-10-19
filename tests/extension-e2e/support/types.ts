import type { localProfileFixture } from './profiles.js';
import type { BrowserContext, Page } from '@playwright/test';
import type { localFixture } from '../../helpers/local-runtime.js';
import type { SessionStatus } from '@protocol';

export interface ExtensionHarness {
  profiles: Awaited<ReturnType<typeof localProfileFixture>>;
  context: BrowserContext;
  clientId: string;
  open(): Promise<Page>;
  runtime: ReturnType<typeof localFixture>;
  status(value: SessionStatus): void;
  errors: string[];
}
