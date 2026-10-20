import { accountPreferencesSchema, CodedError, ErrorCode, type LocalAction, LocalOperation } from '@protocol';
import { RuntimeEvent } from '../../domain/runtime.js';
import { LocalDocumentKind } from '../state/values.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { LocalControllerOptions } from './types.js';

export function documentOperation(
  options: LocalControllerOptions,
  principal: LocalPrincipal,
  action: LocalAction,
): unknown {
  const documents = options.documents;
  const owner = principal.ownerId;

  switch (action.operation) {
    case LocalOperation.PreferencesGet:
      return accountPreferencesSchema.parse(
        documents.get(owner, '', LocalDocumentKind.Preferences).value ?? { language: null, theme: null },
      );

    case LocalOperation.PreferencesSave: {
      const previous = documents.get(owner, '', LocalDocumentKind.Preferences);

      const value = accountPreferencesSchema.parse({
        language: null,
        theme: null,
        ...(previous.value ?? {}),
        ...action.patch,
      });

      documents.save(owner, '', LocalDocumentKind.Preferences, previous.revision, value);

      return value;
    }

    case LocalOperation.ReadingGet: {
      const saved = documents.get(owner, action.sessionId, LocalDocumentKind.Reading);

      return { revision: saved.revision, position: saved.value };
    }

    case LocalOperation.ReadingSave: {
      const saved = documents.save(
        owner,
        action.sessionId,
        LocalDocumentKind.Reading,
        action.revision,
        action.position,
      );

      return { revision: saved.revision, position: saved.value };
    }

    case LocalOperation.Rename:
      return rename(options, owner, action.sessionId, action.title);

    // `execute` already checked the session and its generation.
    case LocalOperation.Pin:
      // Pins are the device owner's: they reach the relay with this device's snapshot.
      if (principal.ownerId !== options.ownerId) {
        throw new CodedError(ErrorCode.ACCESS_DENIED);
      }

      options.monitor.setPinned(action.sessionId, action.pinned);

      return null;

    default:
      throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
  }
}

/**
 * Renames in the agent when it keeps names, and then drops any local label so later renames in the agent show; an
 * agent that keeps no names gets the local label as before.
 */
async function rename(options: LocalControllerOptions, owner: string, sessionId: string, title: string) {
  const { documents } = options;
  const native = (await options.names?.rename(sessionId, title)) ?? false;
  const previous = documents.get(owner, sessionId, LocalDocumentKind.Title);

  if (!native || previous.value !== null) {
    documents.save(owner, sessionId, LocalDocumentKind.Title, previous.revision, native ? null : title);
  }

  options.monitor.emit(RuntimeEvent.Snapshot);

  return null;
}
