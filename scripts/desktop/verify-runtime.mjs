import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { verifyDesktopRuntime } from './verify-runtime-lib.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const [root] = process.argv.slice(2);

if (!root || !resolve(root)) {
  throw new Error('Usage: node scripts/desktop/verify-runtime.mjs /absolute/resources/desktop-companion');
}

const limits = await import(
  pathToFileURL(join(repository, 'dist/packages/protocol/src/local-limits.js')).href
);

const app = JSON.parse(await readFile(join(repository, 'apps/desktop/package.json'), 'utf8'));

const verified = await verifyDesktopRuntime({
  resourceRoot: resolve(root),
  platform: process.platform,
  architecture: process.arch,
  appVersion: app.version,
  protocolVersion: limits.LOCAL_LIMITS.protocolVersion,
});

process.stdout.write(
  `${verified.manifest.kind} ${verified.manifest.node} ${verified.manifest.platform}/${verified.manifest.arch}\n`,
);
