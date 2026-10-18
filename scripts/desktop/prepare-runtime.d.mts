export function prepareDesktopNode(options?: {
  platform?: string;
  architecture?: string;
  toolchainRoot?: string;
}): Promise<string>;
export function verifyPreparedRuntime(
  directory: string,
  platform: string,
  architecture: string,
  target?: { target: string; archiveName: string; archiveSha256: string },
): Promise<string>;
