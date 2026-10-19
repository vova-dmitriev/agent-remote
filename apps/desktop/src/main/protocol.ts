import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { protocol } from 'electron';
import { HttpStatus } from '@protocol';
import { DESKTOP_ASSET_PROTOCOL } from './config/links.js';
import { resolveDesktopAsset } from './protocol/asset-path.js';

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');

export function registerDesktopAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_ASSET_PROTOCOL.slice(0, -1),
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export async function registerDesktopAssets(root: string): Promise<void> {
  await protocol.handle(DESKTOP_ASSET_PROTOCOL.slice(0, -1), async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: HttpStatus.MethodNotAllowed });
    }

    const file = await resolveDesktopAsset(root, request.url);

    if (!file) {
      return new Response(null, { status: HttpStatus.NotFound });
    }

    const content = request.method === 'HEAD' ? null : new Uint8Array(await readFile(file));

    return new Response(content, {
      status: HttpStatus.Ok,
      headers: {
        'content-type': mimeTypes[extname(file)] ?? 'application/octet-stream',
        'content-security-policy': csp,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
      },
    });
  });
}
