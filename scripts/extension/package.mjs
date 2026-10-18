import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension } from './build.mjs';
import { verifyArtifact } from './verify-artifact.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const directory = await buildExtension();
const output = resolve(repository, 'artifacts/chrome-extension');
const archive = resolve(output, 'agent-remote-chrome-extension.zip');

verifyArtifact(directory);
mkdirSync(output, { recursive: true });
rmSync(archive, { force: true });
execFileSync('zip', ['-q', '-r', archive, '.'], { cwd: directory, stdio: 'inherit' });
console.log('Extension package: artifacts/chrome-extension/agent-remote-chrome-extension.zip');
