export const DESKTOP_NODE_RELEASE: {
  readonly version: string;
  readonly abi: string;
  readonly checksumSource: string;
  readonly targets: Readonly<Record<string, string>>;
};
export function desktopNodeTarget(
  platform: string,
  architecture: string,
): {
  target: string;
  archiveName: string;
  archiveSha256: string;
};
export function inspectDesktopNode(nodePath: string): {
  version: string;
  abi: string;
  platform: string;
  arch: string;
};
export function assertPinnedDesktopNode(
  nodePath: string,
  platform: string,
  architecture: string,
): ReturnType<typeof inspectDesktopNode>;
