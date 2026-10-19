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

    case LocalOperation.Rename: {
      const previous = documents.get(owner, action.sessionId, LocalDocumentKind.Title);

      documents.save(owner, action.sessionId, LocalDocumentKind.Title, previous.revision, action.title);
      options.monitor.emit(RuntimeEvent.Snapshot);

      return null;
    }

    default:
      throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
  }
}
