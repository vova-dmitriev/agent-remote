import { spawnSync } from 'node:child_process';

if (process.platform === 'darwin') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CODESIGN_IDENTITY'));

  const result = spawnSync('npm', ['run', 'build:helper'], {
    env,
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    process.stderr.write('Native helper validation build failed.\n');
    process.exitCode = 1;
  }
}
