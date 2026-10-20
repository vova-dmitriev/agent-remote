export function materializeRuntimeLinks(root: string, directory?: string): Promise<void>;
export function packageDesktopRuntime(options: {
  outputDirectory: string;
  nodePath: string;
  sourceDirectory?: string;
}): Promise<unknown>;
export function runtimeFiles(
  root: string,
  directory?: string,
): Promise<Array<{ path: string; sha256: string }>>;
export function copyRuntimeTree(staging: string, output: string): Promise<void>;
