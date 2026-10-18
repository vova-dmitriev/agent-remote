export function materializeRuntimeLinks(root: string, directory?: string): Promise<void>;
export function packageDesktopRuntime(options: {
  outputDirectory: string;
  nodePath: string;
  sourceDirectory?: string;
}): Promise<unknown>;
