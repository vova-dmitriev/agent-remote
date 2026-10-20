import type { TestInfo } from '@playwright/test';
import { LocalDocumentKind } from '@daemon/local/state/values.js';
import type { ExtensionHarness } from './types.js';

export async function captureDiagnostics(extension: ExtensionHarness, info: TestInfo) {
  if (info.status === info.expectedStatus) {
    return;
  }

  const page = extension.context.pages().at(-1);

  await page?.screenshot({ path: info.outputPath('extension.png') });
  const documents = extension.runtime.controller.options.documents;
  const sessionId = extension.runtime.session.id;

  await info.attach('synthetic-companion-state', {
    body: JSON.stringify({
      session: { status: extension.runtime.monitor.session(sessionId)?.status },
      queue: documents.get('owner-local', sessionId, LocalDocumentKind.Queue),
      draft: documents.get('owner-local', sessionId, LocalDocumentKind.Draft),
      barrier: documents.get('owner-local', sessionId, LocalDocumentKind.QueueBarrier),
    }),
    contentType: 'application/json',
  });
}
