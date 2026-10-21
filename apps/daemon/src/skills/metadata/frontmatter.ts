import { SKILL_METADATA_FIELDS } from '../values.js';

export interface SkillMetadata {
  name?: string;
  description?: string;
  userInvocable: boolean;
}

function scalar(value: string): string | undefined {
  const text = value.trim();

  if (
    !text ||
    text.startsWith('&') ||
    text.startsWith('*') ||
    text.startsWith('!') ||
    text.startsWith('{') ||
    text.startsWith('[')
  ) {
    return undefined;
  }

  if (text.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(text);

      return typeof parsed === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  if (text.startsWith("'")) {
    return text.endsWith("'") ? text.slice(1, -1).replaceAll("''", "'") : undefined;
  }

  if (/[|>][+-]?$/.test(text) || /:\s|\s+#/.test(text)) {
    return undefined;
  }

  return text.replace(/\s+#.*$/, '').trim();
}

export function parseSkillMetadata(header: string, fallbackName: string): SkillMetadata | undefined {
  const lines = header.replace(/^\uFEFF/u, '').split(/\r?\n/u);

  if (lines[0] !== '---') {
    return undefined;
  }

  const end = lines.indexOf('---', 1);

  if (end < 0) {
    return undefined;
  }

  const fields = new Map<string, string>();
  let description: string | undefined;
  let ignoredField = false;

  for (let index = 1; index < end; index++) {
    const line = lines[index]!;

    if (/^\s/u.test(line) && ignoredField) {
      continue;
    }

    ignoredField = false;
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]{0,63}):(?:\s+(.*))?$/u);

    if (!match) {
      if (/^\s/u.test(line) && description !== undefined) {
        description += ` ${line.trim()}`;
        continue;
      }

      return undefined;
    }

    const key = match[1]!,
      raw = match[2] ?? '';

    if (
      key !== SKILL_METADATA_FIELDS.name &&
      key !== SKILL_METADATA_FIELDS.description &&
      key !== SKILL_METADATA_FIELDS.userInvocable
    ) {
      ignoredField = true;
      continue;
    }

    if (fields.has(key)) {
      return undefined;
    }

    if (key === SKILL_METADATA_FIELDS.description && /^[|>][+-]?$/.test(raw.trim())) {
      const block: string[] = [];

      while (index + 1 < end && /^\s/u.test(lines[index + 1]!)) {
        block.push(lines[++index]!.trim());
      }

      description = block.join(' ').trim();
      fields.set(key, description);
      continue;
    }

    const parsed = scalar(raw);

    if (parsed === undefined) {
      return undefined;
    }

    fields.set(key, parsed);

    if (key === SKILL_METADATA_FIELDS.description) {
      description = parsed;
    }
  }

  const rawName = fields.get(SKILL_METADATA_FIELDS.name) ?? fallbackName;
  const parsedUserInvocable = fields.get(SKILL_METADATA_FIELDS.userInvocable);

  const normalizedDescription = description
    ?.replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!rawName || rawName.length > 128 || /[\s/\\:]/u.test(rawName)) {
    return undefined;
  }

  if (
    parsedUserInvocable !== undefined &&
    parsedUserInvocable !== 'true' &&
    parsedUserInvocable !== 'false'
  ) {
    return undefined;
  }

  if (!normalizedDescription || normalizedDescription.length > 8192) {
    return undefined;
  }

  return {
    name: rawName,
    description: normalizedDescription,
    userInvocable: parsedUserInvocable !== 'false',
  };
}
