import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const name = (await readdir('artifacts')).find(
  (name) =>
    name.startsWith('claude-remote-') &&
    name.endsWith(`-${process.platform}-${process.arch}-node${process.versions.modules}.tar.gz`),
);

if (!name) {
  throw new Error('ARCHIVE_NOT_FOUND');
}

const archive = join('artifacts', name);
const expected = (await readFile(archive + '.sha256', 'utf8')).split(/\s/)[0];

const actual = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');

if (actual !== expected) {
  throw new Error('CHECKSUM_MISMATCH');
}

const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 10485760 }).split('\n');

for (const entry of entries) {
  if (
    /^(?:\.env(?:$|\.)|\.git\/|\.superpowers\/)/.test(entry) ||
    /(?:^|\/)(?:device\.json|local\.key)$/.test(entry) ||
    entry.startsWith('/') ||
    entry.split('/').includes('..')
  ) {
    throw new Error('UNEXPECTED_ARCHIVE_ENTRY');
  }
}

const directory = await mkdtemp(join(tmpdir(), 'claude-remote-archive-'));

try {
  execFileSync('tar', ['-xzf', join(process.cwd(), archive), '-C', directory]);

  const help = execFileSync(process.execPath, ['apps/daemon/bin/remote.mjs'], {
    cwd: directory,
    encoding: 'utf8',
  });

  if (!help.includes('remote claude') || !help.includes('remote codex')) {
    throw new Error('ARCHIVE_ENTRYPOINT_FAILED');
  }

  const setup = execFileSync(process.execPath, ['apps/daemon/bin/remote.mjs', 'personal'], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
  });

  if (!setup.includes('BOT_TOKEN=')) {
    throw new Error('ARCHIVE_PERSONAL_SETUP_FAILED');
  }

  const code = `import {LocalStore} from './dist/apps/daemon/src/monitor/store.js';import {PtySessionManager} from './dist/apps/daemon/src/code/pty-session-manager.js';const store=new LocalStore('./fixture.sqlite','fixture');if(!store.cursor().streamId)throw new Error('SQLITE_FAILED');store.close();const manager=new PtySessionManager({executable:process.execPath,args:['-e','console.log("ARCHIVE_PTY_OK")']});const binding=manager.start({id:'fixture',cwd:process.cwd()});let text='';manager.onData(binding,chunk=>text+=chunk);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{manager.close();reject(new Error('PTY_TIMEOUT'));},5000);manager.onExit(binding,()=>{clearTimeout(timer);text.includes('ARCHIVE_PTY_OK')?resolve():reject(new Error('PTY_FAILED'));});});console.log('ARCHIVE_NATIVE_OK');`;

  const native = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
  });

  if (!native.includes('ARCHIVE_NATIVE_OK')) {
    throw new Error('ARCHIVE_NATIVE_FAILED');
  }

  const report = {
    archive: name,
    sha256: actual,
    entrypoint: true,
    codexEntrypoint: true,
    personalSetup: true,
    sqlite: true,
    pty: true,
    excludedPrivateState: true,
    passed: true,
  };

  await writeFile('artifacts/archive-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await rm(directory, { recursive: true, force: true });
}
