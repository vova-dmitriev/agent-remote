export function validatePrompt(text: string): string {
  // eslint-disable-next-line no-control-regex -- Intentionally reject control characters at the wire boundary.
  if (typeof text !== 'string' || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/u.test(text)) {
    throw new Error('INVALID_PROMPT');
  }

  if (new TextEncoder().encode(text).length > 16_384) {
    throw new Error('PROMPT_TOO_LARGE');
  }

  return text;
}

export function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);

  return bytes.length <= maxBytes
    ? text
    : new TextDecoder().decode(bytes.subarray(0, maxBytes), { stream: true });
}

export function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`INVALID_${name}`);
  }

  return value;
}
