import type { LocalController } from '../controller/controller.js';
import type { LocalGrants } from '../grants/service.js';

export interface LocalServerOptions {
  path: string;
  capability: string;
  controller: LocalController;
  grants: LocalGrants;
  instanceId?: string;
  refreshOrigins?: () => Promise<readonly string[]>;
}
