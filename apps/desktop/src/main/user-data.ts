import { join } from 'node:path';

/** Directory name under appData that holds companion state; fixed so renaming the app never moves it. */
export const DESKTOP_USER_DATA_DIRECTORY = 'agent-remote-desktop';

export interface UserDataPathHost {
  getPath(name: 'appData'): string;
  setPath(name: 'userData', path: string): void;
}

export function desktopUserDataPath(appDataPath: string): string {
  return join(appDataPath, DESKTOP_USER_DATA_DIRECTORY);
}

export function pinDesktopUserData(host: UserDataPathHost): string {
  const path = desktopUserDataPath(host.getPath('appData'));

  host.setPath('userData', path);

  return path;
}
