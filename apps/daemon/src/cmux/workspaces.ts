import { realpath } from 'node:fs/promises';
import { z } from 'zod';

/** Runs cmux's command line and gives its output. */
export type CmuxRun = (file: string, args: string[]) => Promise<{ stdout: string } | void>;

const windowsSchema = z.array(z.object({ id: z.string() }));

const workspacesSchema = z.object({
  workspaces: z.array(z.object({ id: z.string(), current_directory: z.string().nullish() })),
});

/** The cmux workspace whose terminal is in the given folder, in any cmux window; null when there is none. */
export async function projectWorkspace(run: CmuxRun, cli: string, cwd: string) {
  const listed = async (args: string[]) =>
    JSON.parse((await run(cli, ['--json', '--id-format', 'uuids', ...args]))?.stdout ?? 'null');

  for (const window of windowsSchema.parse(await listed(['list-windows']))) {
    const { workspaces } = workspacesSchema.parse(await listed(['list-workspaces', '--window', window.id]));

    for (const workspace of workspaces) {
      const directory = workspace.current_directory;
      const folder = directory && (await realpath(directory).catch(() => null)); // ignore: a folder now gone.

      if (folder === cwd) {
        return { windowId: window.id, workspaceId: workspace.id };
      }
    }
  }

  return null;
}
