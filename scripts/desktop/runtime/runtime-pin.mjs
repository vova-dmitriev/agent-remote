import { execFileSync } from 'node:child_process';

export const DESKTOP_NODE_RELEASE = Object.freeze({
  version: 'v22.23.3',
  abi: '127',
  checksumSource: 'https://nodejs.org/dist/v22.23.3/SHASUMS256.txt',
  targets: Object.freeze({
    'darwin-arm64': '23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53',
    'darwin-x64': '8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8',
  }),
});

export function desktopNodeTarget(platform, architecture) {
  const target = `${platform}-${architecture}`;
  const archiveSha256 = DESKTOP_NODE_RELEASE.targets[target];

  if (!archiveSha256) {
    throw new Error(`Unsupported desktop runtime target: ${target}`);
  }

  return {
    target,
    archiveName: `node-${DESKTOP_NODE_RELEASE.version}-${platform}-${architecture}.tar.gz`,
    archiveSha256,
  };
}

export function inspectDesktopNode(nodePath) {
  return JSON.parse(
    execFileSync(
      nodePath,
      [
        '-p',
        'JSON.stringify({version:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch})',
      ],
      { encoding: 'utf8', timeout: 5000 },
    ),
  );
}

export function assertPinnedDesktopNode(nodePath, platform, architecture) {
  const observed = inspectDesktopNode(nodePath);

  if (
    observed.version !== DESKTOP_NODE_RELEASE.version ||
    observed.abi !== DESKTOP_NODE_RELEASE.abi ||
    observed.platform !== platform ||
    observed.arch !== architecture
  ) {
    throw new Error('LOCAL_RUNTIME_UNTRUSTED');
  }

  return observed;
}
