import { CodexItemType, CodexContentType } from '../domain/codex.js';
import { ClaudeContentType, ClaudeRecordType } from '../domain/claude.js';
import { ASCII_CONTROL_CHARACTERS } from '../validation/control-characters.js';
import { createHash } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_MESSAGE_ATTACHMENT_BYTES,
} from '../../../../packages/protocol/src/index.js';
import { type NativeMedia } from './types.js';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const imageMime = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function base64(data: unknown, mime: unknown, name: string): NativeMedia[] {
  if (
    typeof data !== 'string' ||
    !data.length ||
    data.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 ||
    data.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/u.test(data)
  ) {
    return [];
  }

  if (typeof mime !== 'string' || (!imageMime.has(mime) && mime !== 'application/pdf')) {
    return [];
  }

  const bytes = Buffer.from(data, 'base64');

  return bytes.length && bytes.length <= MAX_ATTACHMENT_BYTES && bytes.toString('base64') === data
    ? [{ name, mimeType: mime, bytes }]
    : [];
}

function dataImage(value: unknown, name: string): NativeMedia[] {
  if (typeof value !== 'string') {
    return [];
  }

  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([\s\S]+)$/u.exec(value);

  return match ? base64(match[2], match[1], name) : [];
}

function localPath(value: unknown, name: string): NativeMedia[] {
  return typeof value === 'string' &&
    isAbsolute(value) &&
    !value.startsWith('//') &&
    !ASCII_CONTROL_CHARACTERS.test(value)
    ? [{ name: basename(value).slice(0, 255) || name, mimeType: 'image/png', path: value }]
    : [];
}

export function nativeCodexMedia(raw: unknown): NativeMedia[] {
  const item = object(raw);

  if (item.type === CodexItemType.UserMessage && Array.isArray(item.content)) {
    return boundedMedia(
      item.content.flatMap((part) => {
        const input = object(part);

        if (input.type === CodexContentType.LocalImage) {
          return localPath(input.path, 'image.png');
        }

        if (input.type === CodexContentType.Image) {
          return dataImage(input.url, 'image.png');
        }

        return [];
      }),
    );
  }

  if (item.type === CodexItemType.ImageView) {
    return localPath(item.path, 'image.png');
  }

  if (item.type === CodexItemType.ImageGeneration) {
    if (typeof item.savedPath === 'string') {
      return localPath(item.savedPath, 'generated.png');
    }

    return typeof item.result === 'string'
      ? [...dataImage(item.result, 'generated.png'), ...base64(item.result, 'image/png', 'generated.png')]
      : [];
  }

  if (item.type === CodexItemType.DynamicToolCall && Array.isArray(item.contentItems)) {
    return boundedMedia(
      item.contentItems.flatMap((value) => {
        const block = object(value);

        return block.type === CodexContentType.InputImage ? dataImage(block.imageUrl, 'tool-image.png') : [];
      }),
    );
  }

  return [];
}

function claudeBlocks(blocks: unknown, depth = 0, pasteIds: unknown[] = []): NativeMedia[] {
  if (!Array.isArray(blocks) || depth > 2) {
    return [];
  }

  let imageIndex = 0;

  return boundedMedia(
    blocks.slice(0, 500).flatMap((value) => {
      const block = object(value),
        source = object(block.source);

      const pasteId =
        depth === 0 && block.type === ClaudeContentType.Image ? pasteIds[imageIndex++] : undefined;

      if (block.type === ClaudeContentType.ToolResult) {
        return claudeBlocks(block.content, depth + 1);
      }

      if (
        (block.type === ClaudeContentType.Image || block.type === ClaudeContentType.Document) &&
        source.type === ClaudeContentType.Base64
      ) {
        return base64(
          source.data,
          source.media_type,
          block.type === ClaudeContentType.Image ? 'image.png' : 'document.pdf',
        ).map((media) => ({
          ...media,
          ...(typeof pasteId === 'number' && Number.isSafeInteger(pasteId) && pasteId > 0
            ? { placeholder: `[Image #${pasteId}]` }
            : {}),
        }));
      }

      return [];
    }),
  );
}

export function nativeClaudeMedia(raw: unknown): NativeMedia[] {
  const row = object(raw);

  if (row.type === ClaudeRecordType.User || row.type === ClaudeRecordType.Assistant) {
    return claudeBlocks(
      object(row.message).content,
      0,
      row.type === ClaudeRecordType.User && Array.isArray(row.imagePasteIds) ? row.imagePasteIds : [],
    );
  }

  if (row.type !== ClaudeRecordType.Attachment) {
    return [];
  }

  const attachment = object(row.attachment),
    content = object(attachment.content),
    file = object(content.file);

  if (
    attachment.type !== ClaudeContentType.File ||
    ![ClaudeContentType.Image, ClaudeContentType.Pdf].some(
      (candidateValue) => candidateValue === String(content.type),
    )
  ) {
    return [];
  }

  const defaultName = content.type === ClaudeContentType.Pdf ? 'document.pdf' : 'image.png';

  const name =
    typeof attachment.filename === 'string' ? basename(attachment.filename).slice(0, 255) : defaultName;

  return base64(file.base64, content.type === ClaudeContentType.Pdf ? 'application/pdf' : file.type, name);
}

export function boundedMedia(items: NativeMedia[]): NativeMedia[] {
  let total = 0;

  return items.slice(0, MAX_ATTACHMENTS).filter((item) => {
    total += item.bytes?.length ?? 0;

    return total <= MAX_MESSAGE_ATTACHMENT_BYTES;
  });
}

/** Select only explicit media fields and estimate retained encoded bytes without decoding them. */
export function codexMediaCandidate(
  raw: unknown,
): { record: unknown; size: number; fingerprint: string } | undefined {
  const item = object(raw);
  let record: Record<string, unknown> | undefined;

  if (item.type === CodexItemType.UserMessage && Array.isArray(item.content)) {
    record = {
      type: item.type,
      content: item.content
        .filter((value) =>
          [CodexContentType.Image, CodexContentType.LocalImage].some(
            (candidateValue) => candidateValue === String(object(value).type),
          ),
        )
        .map((value) => {
          const part = object(value);

          return part.type === CodexContentType.Image
            ? { type: part.type, url: part.url }
            : { type: part.type, path: part.path };
        }),
    };
  }

  if (item.type === CodexItemType.ImageView) {
    record = { type: item.type, path: item.path };
  }

  if (item.type === CodexItemType.ImageGeneration) {
    record = { type: item.type, savedPath: item.savedPath, result: item.result };
  }

  if (item.type === CodexItemType.DynamicToolCall && Array.isArray(item.contentItems)) {
    record = {
      type: item.type,
      contentItems: item.contentItems
        .filter((value) => object(value).type === CodexContentType.InputImage)
        .map((value) => ({ type: CodexContentType.InputImage, imageUrl: object(value).imageUrl })),
    };
  }

  if (
    !record ||
    (Array.isArray(record.content) && !record.content.length) ||
    (Array.isArray(record.contentItems) && !record.contentItems.length)
  ) {
    return;
  }

  const serialized = JSON.stringify(record);

  return {
    record,
    size: Buffer.byteLength(serialized),
    fingerprint: createHash('sha256').update(serialized).digest('hex'),
  };
}
