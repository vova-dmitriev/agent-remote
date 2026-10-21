import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** The git repository a session works in, so project rules follow it into subdirectories; else its directory. */
export async function projectRoot(cwd: string): Promise<string> {
  for (let directory = cwd; ; directory = dirname(directory)) {
    if (
      await stat(join(directory, '.git')).then(
        () => true,
        () => false,
      )
    ) {
      return directory;
    }

    if (dirname(directory) === directory) {
      return cwd;
    }
  }
}
