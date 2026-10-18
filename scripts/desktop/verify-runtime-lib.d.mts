export interface DesktopRuntimeManifest {
  kind: 'desktop-companion';
  appVersion: string;
  node: string;
  abi: string;
  nodeArchiveSha256: string;
  platform: string;
  arch: string;
  protocolVersion: number;
  helperIdentity: string;
  helper: { path: string; sha256: string } | null;
  addons: Array<{ path: string; sha256: string }>;
  files: Array<{ path: string; sha256: string }>;
  runtime: { nodePath: string; entryPath: string; nodeSha256: string; entrySha256: string };
}
export function verifyDesktopRuntime(options: {
  resourceRoot: string;
  platform: string;
  architecture: string;
  appVersion: string;
  protocolVersion: number;
}): Promise<{ root: string; manifest: DesktopRuntimeManifest; nodePath: string; entryPath: string }>;
