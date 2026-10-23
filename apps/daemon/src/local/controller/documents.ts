import { readSessionFile } from '../../files/session-files.js';
import { accountPreferencesSchema, CodedError, ErrorCode, type LocalAction, LocalOperation } from '@protocol';
import { RuntimeEvent } from '../../domain/runtime.js';
import { LocalDocumentKind } from '../state/values.js';
import type { LocalPrincipal } from '../grants/types.js';
import type { LocalControllerOptions } from './types.js';
import { logDebug } from '../../diagnostics/log.js';
import { analyticsFilter } from '../../analytics/report.js';

/**
 * Operations on the owner's documents, labels, pins, removals, models, changed files and usage, answered by
 * `documentOperation`.
 */
export const DOCUMENT_OPERATIONS: ReadonlySet<LocalOperation> = new Set([
  LocalOperation.PreferencesGet,
  LocalOperation.PreferencesSave,
  LocalOperation.ReadingGet,
  LocalOperation.ReadingSave,
  LocalOperation.Rename,
  LocalOperation.Pin,
  LocalOperation.MarkRead,
  LocalOperation.Remove,
  LocalOperation.Model,
  LocalOperation.Create,
  LocalOperation.File,
  LocalOperation.Analytics,
  LocalOperation.Rules,
]);

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

    case LocalOperation.MarkRead:
      // Read marks are the device owner's, like pins.
      if (principal.ownerId !== options.ownerId) {
        throw new CodedError(ErrorCode.ACCESS_DENIED);
      }

      options.monitor.markRead(action.sessionId, action.at);

      return null;

    // A session in one of the device's projects is the device owner's, like any session started there.
    case LocalOperation.Create:
      if (principal.ownerId !== options.ownerId) {
        throw new CodedError(ErrorCode.ACCESS_DENIED);
      }

      if (!options.projects) {
        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      return options.projects.create(action.session).then((sessionId) => ({ sessionId }));

    // The device owner picks the models of the device's sessions, like their names.
    case LocalOperation.Model:
      if (principal.ownerId !== options.ownerId) {
        throw new CodedError(ErrorCode.ACCESS_DENIED);
      }

      if (!options.models) {
        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      return options.models.switch(action.sessionId, action.choice).then(() => null);

    // Like pins, what the owner hid is the device owner's; the session leaves the lists at once, ending may take longer.
    case LocalOperation.Remove:
      if (principal.ownerId !== options.ownerId) {
        throw new CodedError(ErrorCode.ACCESS_DENIED);
      }

      if (!options.removal) {
        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      void options.removal
        .remove(action.sessionId, action.mode)
        .catch((error: unknown) => logDebug('local/controller/documents', error));

      return null;

    // A changed file's text is the device owner's, like the session's transcript.
    case LocalOperation.File:
      if (principal.ownerId !== options.ownerId) {
        throw new CodedError(ErrorCode.ACCESS_DENIED);
      }

      return readSessionFile(options.monitor, action.sessionId, action.path);

    // Usage is the device owner's, like the transcripts it is counted from.
    case LocalOperation.Analytics:
      if (principal.ownerId !== options.ownerId) {
        throw new CodedError(ErrorCode.ACCESS_DENIED);
      }

      if (!options.analytics) {
        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      return options.analytics.report({ period: action.period, ...analyticsFilter(action) });

    // Rules gate the owner's own agents.
    case LocalOperation.Rules:
      if (principal.ownerId !== options.ownerId) {
        throw new CodedError(ErrorCode.ACCESS_DENIED);
      }

      if (!options.rules) {
        throw new CodedError(ErrorCode.CAPABILITY_UNAVAILABLE);
      }

      return options.rules.apply(action.request);

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
