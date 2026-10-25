import { DaemonErrorCode } from '../../error-codes.js';
import { execFile } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CodedError } from '@protocol';

/** `remote personal <action>`: the macOS login service that keeps `remote personal` running. */
export const PersonalServiceAction = {
  Install: 'install',
  Uninstall: 'uninstall',
  Start: 'start',
  Stop: 'stop',
  Restart: 'restart',
} as const;
export type PersonalServiceAction = (typeof PersonalServiceAction)[keyof typeof PersonalServiceAction];

export const PERSONAL_SERVICE_LABEL = 'com.agentremote.personal';
/** Seconds launchd waits before it starts a service that exited again, e.g. while Docker is still starting. */
const RESTART_THROTTLE_SECONDS = 30;

export type Launchctl = (args: string[]) => Promise<void>;

const run = promisify(execFile);

const launchctl: Launchctl = async (args) => {
  await run('/bin/launchctl', args, { timeout: 15_000, maxBuffer: 65536 });
};

export const personalServicePaths = (home = homedir()) => ({
  plist: join(home, 'Library/LaunchAgents', `${PERSONAL_SERVICE_LABEL}.plist`),
  log: join(home, 'Library/Logs/Agent Remote/personal.log'),
});

const domain = () => `gui/${process.getuid?.() ?? 0}`;
const service = () => `${domain()}/${PERSONAL_SERVICE_LABEL}`;
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const string = (value: string) => `<string>${xml(value)}</string>`;

/** The launch agent: starts at login, and again whenever it stops; PATH is the installer's, so docker and the agents resolve. */
export function personalServicePlist(options: { root: string; node: string; path: string; log: string }) {
  const program = [options.node, join(options.root, 'apps/daemon/bin/remote.mjs'), 'personal'];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${string(PERSONAL_SERVICE_LABEL)}
  <key>ProgramArguments</key><array>${program.map(string).join('')}</array>
  <key>WorkingDirectory</key>${string(options.root)}
  <key>EnvironmentVariables</key><dict><key>PATH</key>${string(options.path)}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>${RESTART_THROTTLE_SECONDS}</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key>${string(options.log)}
  <key>StandardErrorPath</key>${string(options.log)}
</dict>
</plist>
`;
}

const loaded = (control: Launchctl) =>
  control(['print', service()]).then(
    () => true,
    () => false,
  );

async function bootstrap(control: Launchctl, plist: string) {
  await access(plist).catch(() => {
    throw new CodedError(DaemonErrorCode.PERSONAL_SERVICE_NOT_INSTALLED);
  });

  await control(['bootstrap', domain(), plist]);
}

export async function runPersonalService(
  action: PersonalServiceAction,
  options: { root?: string; home?: string; control?: Launchctl; platform?: NodeJS.Platform } = {},
) {
  if ((options.platform ?? process.platform) !== 'darwin') {
    throw new CodedError(DaemonErrorCode.PERSONAL_SERVICE_UNSUPPORTED);
  }

  const control = options.control ?? launchctl;
  const paths = personalServicePaths(options.home);
  const running = await loaded(control);

  switch (action) {
    case PersonalServiceAction.Install: {
      if (!options.root) {
        throw new CodedError(DaemonErrorCode.PERSONAL_SERVICE_NOT_INSTALLED);
      }

      if (running) {
        await control(['bootout', service()]);
      }

      await mkdir(join(paths.log, '..'), { recursive: true, mode: 0o700 });
      await mkdir(join(paths.plist, '..'), { recursive: true });
      const path = process.env.PATH ?? '/usr/bin:/bin';

      await writeFile(
        paths.plist,
        personalServicePlist({ root: options.root, node: process.execPath, path, ...paths }),
        {
          mode: 0o644,
        },
      );

      await bootstrap(control, paths.plist);

      return;
    }

    case PersonalServiceAction.Uninstall:
      if (running) {
        await control(['bootout', service()]);
      }

      await rm(paths.plist, { force: true });

      return;
    case PersonalServiceAction.Stop:
      if (running) {
        await control(['bootout', service()]);
      }

      return;

    default:
      // A stopped service is booted out, so it is loaded again; a loaded one is started, or killed and started.
      if (!running) {
        await bootstrap(control, paths.plist);
      } else {
        await control(['kickstart', ...(action === PersonalServiceAction.Restart ? ['-k'] : []), service()]);
      }
  }
}
