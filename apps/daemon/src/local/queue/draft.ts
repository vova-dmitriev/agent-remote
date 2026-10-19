import { CommandActionType } from '@protocol';
import { LocalDocumentKind } from '../state/values.js';
import type { LocalControllerOptions } from '../controller/types.js';
import type { QueuedIntent } from './types.js';

export function clearMatchingDraft(
  options: LocalControllerOptions,
  sessionId: string,
  generation: string,
  entries: QueuedIntent[],
) {
  const saved = options.documents.get(options.ownerId, sessionId, LocalDocumentKind.Draft);

  const draft = saved.value as {
    generation?: string;
    text?: string;
    attachments?: { id: string }[];
  } | null;

  if (!draft || draft.generation !== generation) {
    return;
  }

  if (
    entries.some(
      ({ command }) =>
        command.action.type === CommandActionType.Prompt &&
        command.action.text === draft.text &&
        JSON.stringify(command.action.attachments?.map((item) => item.id) ?? []) ===
          JSON.stringify(draft.attachments?.map((item) => item.id) ?? []),
    )
  ) {
    options.documents.save(options.ownerId, sessionId, LocalDocumentKind.Draft, saved.revision, {
      generation,
      text: '',
      attachments: [],
    });
  }
}
