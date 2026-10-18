import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { DESKTOP_ASSET_HOST, DESKTOP_ASSET_PROTOCOL } from '../config/links.js';

export async function resolveDesktopAsset(root: string, rawUrl: string): Promise<string | null> {
  try {
    if (/%2f|%5c|%00|\\|\/(?:%2e|\.)(?:%2e|\.)(?:\/|%2f|%5c)/iu.test(rawUrl)) {
      return null;
    }

    const url = new URL(rawUrl);

    if (
      url.protocol !== DESKTOP_ASSET_PROTOCOL ||
      url.hostname !== DESKTOP_ASSET_HOST ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    const decoded = decodeURIComponent(url.pathname);

    if (
      !decoded.startsWith('/') ||
      decoded.includes('\\') ||
      decoded.split('/').some((part) => part === '..' || part === '.')
    ) {
      return null;
    }

    const rootPath = await realpath(root);
    const candidate = resolve(rootPath, `.${decoded}`);
    const path = relative(rootPath, candidate);

    if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      return null;
    }

    let current = rootPath;

    for (const part of path.split(sep)) {
      current = resolve(current, part);

      if ((await lstat(current)).isSymbolicLink()) {
        return null;
      }
    }

    const finalPath = await realpath(candidate);

    if (relative(rootPath, finalPath).startsWith(`..${sep}`)) {
      return null;
    }

    if (!(await lstat(finalPath)).isFile()) {
      return null;
    }

    return finalPath;
  } catch {
    return null;
  }
}
