import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.platform !== 'darwin') {
  throw new Error('MACOS_REQUIRED');
}

execFileSync('swift', ['build', '--package-path', 'apps/macos-helper', '-c', 'release'], {
  stdio: 'inherit',
});

const app = 'artifacts/ClaudeRemoteBridge.app',
  contents = join(app, 'Contents');

mkdirSync(join(contents, 'MacOS'), { recursive: true });
copyFileSync('apps/macos-helper/.build/release/ClaudeBridge', join(contents, 'MacOS/ClaudeBridge'));
copyFileSync('apps/macos-helper/Resources/Info.plist', join(contents, 'Info.plist'));

execFileSync(
  'codesign',
  [
    '--force',
    '--sign',
    process.env.CODESIGN_IDENTITY ?? '-',
    '--identifier',
    'dev.claude-remote.accessibility',
    '--entitlements',
    'apps/macos-helper/Resources/ClaudeBridge.entitlements',
    app,
  ],
  { stdio: 'inherit' },
);

execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
console.log(process.env.CODESIGN_IDENTITY ? 'DEVELOPER_ID_SIGNED' : 'AD_HOC_SIGNED_LOCAL_BUILD');
