import { z } from 'zod';
import { chromeApi } from '../config/chrome-api.js';
import { ExtensionApiValue } from '../config/values.js';
import { ViewerRegistry } from './registry.js';

z.config({ jitless: true });

const api = chromeApi();
const viewers = new ViewerRegistry(api);

api.runtime.onConnect.addListener((port) => {
  viewers.attach(port);
});

void api.storage.local.setAccessLevel({ accessLevel: ExtensionApiValue.TrustedContexts });
void api.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
