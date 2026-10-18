import { ErrorCode } from '../../../protocol/src/error-codes.js';

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let start = 0; start < bytes.length; start += 32768) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
  }

  return btoa(binary);
}

export function decodeBase64(text: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error(ErrorCode.INVALID_FRAME);
  }

  const binary = atob(text);

  if (btoa(binary) !== text) {
    throw new Error(ErrorCode.INVALID_FRAME);
  }

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
