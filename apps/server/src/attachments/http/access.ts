import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '@protocol';
import type { Request } from 'express';
import { AuthService } from '../../auth/auth-service.js';
import { Database } from '../../db/database.js';
import { DeviceService } from '../../devices/service.js';
import { bearer } from '../../http/auth/bearer.js';
import { Fault } from '../../http/errors/fault.js';
import type { AttachmentContext } from '../service.js';

/** The owner's routes and the paired device's routes for one session's attachments. */
export const AttachmentRoute = {
  Owner: 'sessions/:sessionId/attachments',
  Device: 'device/sessions/:sessionId/attachments',
} as const;

export type AttachmentRoute = (typeof AttachmentRoute)[keyof typeof AttachmentRoute];

export interface AttachmentScope {
  context: AttachmentContext;
  deviceMode: boolean;
}

const MAX_SESSION_ID_LENGTH = 512;
const DEVICE_ROUTE_PREFIX = '/' + AttachmentRoute.Device;

/** Resolves who uses a session's attachments: its paired device, or its owner while the device is not revoked. */
@Injectable()
export class AttachmentAccess {
  private readonly scopes = new WeakMap<Request, AttachmentScope>();

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DeviceService) private readonly devices: DeviceService,
  ) {}

  async authorize(req: Request) {
    const sessionId = String(req.params.sessionId);
    const deviceMode = this.isDeviceRoute(req);

    if (sessionId.length > MAX_SESSION_ID_LENGTH) {
      throw new Fault(ErrorCode.INVALID_REQUEST);
    }

    if (deviceMode) {
      const device = await this.devices.authenticate(bearer(req));

      this.scopes.set(req, {
        context: { ownerId: device.owner_id, deviceId: device.id, sessionId },
        deviceMode,
      });

      return;
    }

    const principal = await this.auth.authenticate(bearer(req));

    const row = (
      await this.db.pool.query<{ device_id: string }>(
        'SELECT s.device_id FROM sessions s JOIN devices d ON d.id=s.device_id AND d.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.id=$2 AND d.revoked_at IS NULL',
        [principal.userId, sessionId],
      )
    ).rows[0];

    if (!row) {
      throw new Fault(ErrorCode.NOT_FOUND);
    }

    this.scopes.set(req, {
      context: { ownerId: principal.userId, deviceId: row.device_id, sessionId },
      deviceMode,
    });
  }

  /** The scope `authorize` resolved for this request. */
  scope(req: Request): AttachmentScope {
    const scope = this.scopes.get(req);

    if (!scope) {
      throw new Fault(ErrorCode.UNAUTHORIZED);
    }

    return scope;
  }

  /** Checks the bearer again, for an upload whose body took time to arrive. */
  async reauthenticate(req: Request) {
    if (this.scope(req).deviceMode) {
      await this.devices.authenticate(bearer(req));
    } else {
      await this.auth.authenticate(bearer(req));
    }
  }

  // The matched route pattern, not the raw URL, decides the mode: Express matches paths case-insensitively.
  private isDeviceRoute(req: Request) {
    return String(req.route?.path).startsWith(DEVICE_ROUTE_PREFIX);
  }
}

/** Authorizes attachment reads before the handler runs. */
@Injectable()
export class AttachmentGuard implements CanActivate {
  constructor(@Inject(AttachmentAccess) private readonly access: AttachmentAccess) {}

  async canActivate(context: ExecutionContext) {
    await this.access.authorize(context.switchToHttp().getRequest<Request>());

    return true;
  }
}
