import { join } from 'node:path';
import { CodedError, ErrorCode, LocalOrigin } from '@protocol';
import { runtimeConfiguration } from '../../local/bootstrap/configuration.js';
import { LocalDatabase } from '../../local/state/database.js';
import { LocalGrants } from '../../local/grants/service.js';
import { BrowserAction } from '../../domain/browser.js';
import { extensionOrigin } from './install.js';
import { requireSettings } from './settings.js';
import type { BrowserCliContext } from './types.js';

export async function browserGrants(
  context: BrowserCliContext,
  action: BrowserAction,
  clientId?: string,
  extensionId?: string,
) {
  if (action === BrowserAction.AuthorizeDesktop && !clientId) {
    throw new CodedError(ErrorCode.INVALID_REQUEST);
  }

  if (clientId && !/^[a-f0-9-]{36}$/.test(clientId)) {
    throw new CodedError(ErrorCode.INVALID_REQUEST);
  }

  const settings =
    action === BrowserAction.AuthorizeDesktop || action === BrowserAction.Revoke
      ? null
      : await requireSettings(context.directory);

  const identity = await runtimeConfiguration(context.directory);
  const database = new LocalDatabase(join(context.directory, 'local-client.sqlite'));

  try {
    const grants = new LocalGrants(database, identity.ownerId, identity.deviceId, settings?.origins ?? []);

    if (action === BrowserAction.AuthorizeDesktop && clientId) {
      grants.approve(clientId, LocalOrigin.Desktop);

      return;
    }

    if (action === BrowserAction.Revoke) {
      grants.revoke(clientId!);

      return;
    }

    if (clientId) {
      const origin = extensionOrigin(extensionId);

      if (!settings?.origins.includes(origin)) {
        throw new CodedError(ErrorCode.UNAUTHORIZED);
      }

      grants.approve(clientId, origin);

      return;
    }

    for (const pending of grants.pending()) {
      if (!pending.origin.startsWith('chrome-extension://')) {
        continue;
      }

      const id = pending.origin.slice('chrome-extension://'.length, -1);

      context.output.write(
        `${pending.clientId} ${id}\nApprove once: remote browser authorize ${pending.clientId} ${id}\n`,
      );
    }
  } finally {
    database.close();
  }
}
