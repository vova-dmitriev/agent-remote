import { join } from 'node:path';
import { ManagedCodexPath } from './values.js';

export function managedCodexSocketPath(directory: string) {
  return join(directory, ManagedCodexPath.Directory, ManagedCodexPath.Socket);
}
