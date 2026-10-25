import { dialog, Menu, shell } from 'electron';
import {
  PersonalServiceAction,
  personalServicePaths,
  runPersonalService,
} from '@daemon/cli/personal/personal-service.js';
import { errorCode } from '@protocol';

const failed = (error: unknown) =>
  dialog.showErrorBox(
    'Server',
    errorCode(error) ?? 'The server could not be controlled. See Server → Open Log.',
  );

const control = (action: PersonalServiceAction) => () => void runPersonalService(action).catch(failed);

/**
 * The app menu with a Server menu that drives the login service `remote personal install` sets up. Opening the app
 * starts the service when it is installed but stopped; without it the app works as before.
 */
export function installServerMenu() {
  if (process.platform !== 'darwin') {
    return;
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      {
        label: 'Server',
        submenu: [
          { label: 'Start', click: control(PersonalServiceAction.Start) },
          { label: 'Restart', click: control(PersonalServiceAction.Restart) },
          { label: 'Stop', click: control(PersonalServiceAction.Stop) },
          { type: 'separator' },
          { label: 'Open Log', click: () => void shell.openPath(personalServicePaths().log) },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );

  // ignore: a Mac without the service installed keeps working through its local companion.
  void runPersonalService(PersonalServiceAction.Start).catch(() => undefined);
}
