import { open, lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { SKILLS_SCAN_LIMIT } from './values.js';

export interface CatalogRequest {
  cwd: string;
  home: string;
  configDirectory: string;
  args: readonly string[];
  assertCurrent: () => Promise<void>;
}

export const within = (root: string, path: string) => {
  const rel = relative(root, path);

  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

export async function checked<T>(request: CatalogRequest, operation: () => Promise<T>): Promise<T> {
  await request.assertCurrent();
  const value = await operation();

  await request.assertCurrent();

  return value;
}

export async function directory(
  request: CatalogRequest,
  path: string,
  scope: string,
): Promise<string | undefined> {
  try {
    const info = await checked(request, () => lstat(path));

    if (!info.isDirectory() || info.isSymbolicLink()) {
      return undefined;
    }

    const [canonical, scopePath] = await checked(request, () =>
      Promise.all([realpath(path), realpath(scope)]),
    );

    return within(scopePath, canonical) ? canonical : undefined;
  } catch {
    return undefined;
  }
}

export async function header(
  request: CatalogRequest,
  path: string,
  remaining: { bytes: number; truncated: boolean },
): Promise<string | undefined> {
  try {
    const info = await checked(request, () => lstat(path));

    if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
      return undefined;
    }

    if (remaining.bytes <= 0) {
      remaining.truncated = true;

      return undefined;
    }

    const file = await checked(request, () => open(path, 'r'));

    try {
      const buffer = Buffer.alloc(Math.min(SKILLS_SCAN_LIMIT.headerBytes, remaining.bytes));
      const { bytesRead } = await checked(request, () => file.read(buffer, 0, buffer.length, 0));

      remaining.bytes -= bytesRead;
      const text = buffer.subarray(0, bytesRead).toString('utf8');
      const end = text.indexOf('\n---', text.startsWith('---') ? 3 : 0);

      return end < 0 ? undefined : text.slice(0, end + 4);
    } finally {
      await checked(request, () => file.close());
    }
  } catch {
    return undefined;
  }
}

export async function entries(request: CatalogRequest, path: string) {
  try {
    return await checked(request, () => readdir(path, { withFileTypes: true }));
  } catch {
    return [];
  }
}

export async function readJson(
  request: CatalogRequest,
  path: string,
  maxBytes = 65536,
): Promise<Record<string, unknown> | undefined> {
  try {
    const info = await checked(request, () => lstat(path));

    if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) {
      return undefined;
    }

    const handle = await checked(request, () => open(path, 'r'));

    try {
      const buffer = Buffer.alloc(info.size);
      const { bytesRead } = await checked(request, () => handle.read(buffer, 0, buffer.length, 0));
      const parsed: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));

      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } finally {
      await checked(request, () => handle.close());
    }
  } catch {
    return undefined;
  }
}
