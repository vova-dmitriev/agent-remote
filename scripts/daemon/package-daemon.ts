import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };

await mkdir('artifacts', { recursive: true });
const name = `claude-remote-${pkg.version}-${process.platform}-${process.arch}-node${process.versions.modules}.tar.gz`;

const files = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'dist',
  'apps/daemon/bin',
  'scripts/build/prepare-node-pty.mjs',
  'node_modules',
  'THIRD_PARTY_NOTICES.md',
  'README.md',
  'docs',
  'compose.local.yml',
];

if (process.platform === 'darwin') {
  files.push('artifacts/ClaudeRemoteBridge.app');
}

execFileSync('tar', ['-czf', 'artifacts/' + name, ...files], { stdio: 'inherit' });

const checksum = createHash('sha256')
  .update(await readFile('artifacts/' + name))
  .digest('hex');

await writeFile('artifacts/' + name + '.sha256', checksum + '  ' + name + '\n');
console.log(name + '\nSHA256 ' + checksum);
