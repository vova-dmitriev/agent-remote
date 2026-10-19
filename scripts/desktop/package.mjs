import { access, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { packageDesktopRuntime } from './package-runtime.mjs';
import { prepareDesktopNode } from './prepare-runtime.mjs';
import { verifyDesktopRuntime } from './verify-runtime-lib.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const app = JSON.parse(await readFile(join(repository, 'apps/desktop/package.json'), 'utf8'));
const nodePath = await prepareDesktopNode();
const outputDirectory = resolve(repository, 'apps/desktop/dist/desktop-companion');

await access(nodePath, constants.X_OK);
await rm(outputDirectory, { recursive: true, force: true });

const manifest = await packageDesktopRuntime({ outputDirectory, nodePath });

const limits = await import(
  pathToFileURL(join(repository, 'dist/packages/protocol/src/local/local-limits.js')).href
);

await verifyDesktopRuntime({
  resourceRoot: outputDirectory,
  platform: process.platform,
  architecture: process.arch,
  appVersion: app.version,
  protocolVersion: limits.LOCAL_LIMITS.protocolVersion,
});

process.stdout.write(
  `Verified ${manifest.kind} runtime for ${manifest.platform}/${manifest.arch} with ${manifest.node} (${nodePath})\n`,
);
