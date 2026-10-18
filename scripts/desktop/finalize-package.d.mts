export function removePackagerMetadata(resourceRoot: string): Promise<boolean>;

export function finalizePackagedDesktop(options: {
  outputPaths: string[];
  platform: string;
  arch: string;
}): Promise<unknown[]>;
