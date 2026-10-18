import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const untrusted = () => new Error('LOCAL_RUNTIME_UNTRUSTED');

export async function listRuntimeFiles(root, directory = root) {
  const files = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const info = await lstat(path);

    if (entry.name === 'runtime-manifest.json' && info.isFile()) {
      continue;
    }

    if (
      info.isSymbolicLink() ||
      info.mode & 0o022 ||
      (process.getuid && info.uid !== process.getuid() && info.uid !== 0)
    ) {
      throw untrusted();
    }

    if (info.isDirectory()) {
      files.push(...(await listRuntimeFiles(root, path)));
    } else if (info.isFile() && entry.name !== 'runtime-manifest.json') {
      files.push(
        path
          .slice(root.length + 1)
          .split('\\')
          .join('/'),
      );
    } else {
      throw untrusted();
    }
  }

  return files.sort();
}
