import { CodedError, ErrorCode } from '@protocol';
import { CodexItemType } from '../../domain/codex/codex.js';
import { JsonPatchOperation } from '../../domain/codex/codex-desktop.js';
import { object, type Data } from '../events.js';

export function desktopTurns(state: Data): Data[] {
  const history = object(object(state.turnHistory).history),
    entities = object(history.entitiesByKey);

  const ordered: unknown[] = [];

  for (const island of Array.isArray(history.islands) ? history.islands : []) {
    for (const entry of Array.isArray(object(island).entries) ? (object(island).entries as unknown[]) : []) {
      const key = object(entry).value;

      if (typeof key === 'string' && Object.hasOwn(entities, key)) {
        ordered.push(entities[key]);
      }
    }
  }

  const turns = new Map<string, Data>();

  for (const raw of [...ordered, ...(Array.isArray(state.turns) ? state.turns : [])]) {
    const turn = object(raw),
      id = turn.turnId;

    if (typeof id !== 'string') {
      continue;
    }

    const sourceItems: unknown[] = Array.isArray(turn.items) ? turn.items : [];
    let items = sourceItems.slice(-500);
    const input = object(turn.params).input;

    if (Array.isArray(input) && input.length) {
      const primary = sourceItems.find((item) => object(item).type === CodexItemType.UserMessage);

      // The preliminary input and its canonical item represent the same message.
      // Later steering inputs keep their own identities, even when their text matches.
      if (primary) {
        items = items.map((item) => (item === primary ? { ...object(item), id: 'turn-input' } : item));
      } else {
        items.unshift({ id: 'turn-input', type: CodexItemType.UserMessage, content: input });
      }
    }

    turns.set(id, { ...turn, id, items });
  }

  return [...turns.values()].slice(-100);
}

export function applyDesktopPatches(state: Data, patches: unknown[]): Data {
  if (patches.length > 10000) {
    throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
  }

  for (const raw of patches) {
    const patch = object(raw),
      path = patch.path;

    if (
      !Array.isArray(path) ||
      !path.length ||
      path.length > 64 ||
      ![JsonPatchOperation.Add, JsonPatchOperation.Remove, JsonPatchOperation.Replace].some(
        (candidateValue) => candidateValue === String(patch.op),
      ) ||
      path.some(
        (key) =>
          !['string', 'number'].includes(typeof key) ||
          ['__proto__', 'prototype', 'constructor'].includes(String(key)),
      )
    ) {
      throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    let target: unknown = state;

    for (const key of path.slice(0, -1)) {
      if (!target || typeof target !== 'object' || !Object.hasOwn(target, key)) {
        throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
      }

      target = (target as Data)[key];
    }

    const key: string | number = path.at(-1);

    if (!target || typeof target !== 'object') {
      throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
    }

    if (Array.isArray(target)) {
      if (
        key === 'length' &&
        patch.op === JsonPatchOperation.Replace &&
        Number.isInteger(patch.value) &&
        Number(patch.value) >= 0 &&
        Number(patch.value) <= target.length
      ) {
        target.length = Number(patch.value);
        continue;
      }

      if (
        typeof key !== 'number' ||
        !Number.isInteger(key) ||
        key < 0 ||
        key > target.length ||
        (patch.op !== JsonPatchOperation.Add && key === target.length)
      ) {
        throw new CodedError(ErrorCode.CODEX_PROTOCOL_ERROR);
      }

      if (patch.op === JsonPatchOperation.Remove) {
        target.splice(key, 1);
      } else if (patch.op === JsonPatchOperation.Add) {
        target.splice(key, 0, patch.value);
      } else {
        target[key] = patch.value;
      }
    } else if (patch.op === JsonPatchOperation.Remove) {
      delete (target as Data)[key];
    } else {
      (target as Data)[key] = patch.value;
    }
  }

  return state;
}

export function desktopModel(state: Data): unknown {
  return object(object(state.latestCollaborationMode).settings).model ?? state.latestModel;
}
