import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { packagedCompanionFixture } from './packaged-companion.js';
import { isolateRuntimeHome, terminateRuntimeProcesses, trackRuntimeRoot } from './runtime-processes.js';
import { packageDesktopRuntime } from '../../../scripts/desktop/package-runtime.mjs';
import { prepareDesktopNode } from '../../../scripts/desktop/prepare-runtime.mjs';

export async function desktopRuntimeFixture() {
  const nodePath = await prepareDesktopNode();
  const companion = await packagedCompanionFixture(nodePath);

  const root = await mkdtemp(
    process.platform === 'darwin' ? '/private/tmp/desktop-runtime-' : '/tmp/desktop-runtime-',
  );

  trackRuntimeRoot(root);

  let restoreHome = () => {};

  const close = async () => {
    await terminateRuntimeProcesses([root]);
    restoreHome();
    await companion.close();
    await rm(root, { recursive: true, force: true });
  };

  try {
    // Companions launched for the test inherit this environment and must never see the real home.
    restoreHome = await isolateRuntimeHome(join(root, 'isolated'));
    const resourceRoot = join(root, 'resources with spaces');

    await mkdir(resourceRoot, { mode: 0o700 });

    await packageDesktopRuntime({
      outputDirectory: join(resourceRoot, 'desktop-companion'),
      nodePath: companion.nodePath,
      sourceDirectory: companion.sourceDirectory,
    });

    return {
      root,
      artifact: join(resourceRoot, 'desktop-companion'),
      resourceRoot,
      nodePath: companion.nodePath,
      close,
    };
  } catch (error) {
    await close();

    throw error;
  }
}
