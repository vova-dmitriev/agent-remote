import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  ErrorCode,
  LocalGrantStatus,
  LocalOrigin,
  LOCAL_LIMITS,
} from '../../../../../packages/protocol/src/index.js';
import type { LocalDatabase } from '../state/database.js';
import type { GrantRow, LocalPrincipal } from './types.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

export class LocalGrants {
  private origins: readonly string[];

  constructor(
    private database: LocalDatabase,
    private ownerId: string,
    private deviceId: string,
    origins: readonly string[],
  ) {
    this.origins = [...origins, LocalOrigin.Desktop];
  }

  replaceOrigins(origins: readonly string[]) {
    if (
      origins.length > LOCAL_LIMITS.maxClients ||
      origins.some((origin) => !/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin))
    ) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    this.origins = [...origins, LocalOrigin.Desktop];
  }

  private row(client: string, origin: string) {
    return this.database.connection
      .prepare(
        'SELECT client,origin,status,token_hash,expires_at FROM local_grants WHERE owner=? AND client=? AND origin=?',
      )
      .get(this.ownerId, client, origin) as GrantRow | undefined;
  }

  connect(origin: string, clientId: string, handle?: string): LocalPrincipal {
    if (
      !this.origins.includes(origin) ||
      !(origin === LocalOrigin.Desktop || /^chrome-extension:\/\/[a-p]{32}\/$/.test(origin)) ||
      !/^[a-f0-9-]{36}$/.test(clientId)
    ) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    const row = this.row(clientId, origin);

    if (
      !row ||
      ((row.status === LocalGrantStatus.Pending ||
        (row.status === LocalGrantStatus.Approved && !row.token_hash)) &&
        row.expires_at < Date.now())
    ) {
      this.database.connection
        .prepare('DELETE FROM local_grants WHERE owner=? AND status=? AND expires_at<?')
        .run(this.ownerId, LocalGrantStatus.Pending, Date.now());

      const count = this.database.connection
        .prepare('SELECT count(*) AS count FROM local_grants WHERE owner=?')
        .get(this.ownerId) as { count: number };

      if (!row && count.count >= LOCAL_LIMITS.maxGrantRecords) {
        throw new Error(ErrorCode.LOCAL_CLIENT_LIMIT);
      }

      this.database.connection
        .prepare(
          'INSERT INTO local_grants VALUES(?,?,?,?,?,?) ON CONFLICT(owner,client,origin) DO UPDATE SET status=excluded.status,token_hash=NULL,expires_at=excluded.expires_at',
        )
        .run(
          this.ownerId,
          clientId,
          origin,
          LocalGrantStatus.Pending,
          null,
          Date.now() + LOCAL_LIMITS.pendingGrantExpiryMs,
        );

      throw new Error(ErrorCode.LOCAL_APPROVAL_REQUIRED);
    }

    if (row.status === LocalGrantStatus.Revoked) {
      throw new Error(ErrorCode.LOCAL_GRANT_REVOKED);
    }

    if (row.status !== LocalGrantStatus.Approved || (!row.token_hash && row.expires_at < Date.now())) {
      throw new Error(ErrorCode.LOCAL_APPROVAL_REQUIRED);
    }

    let token = handle;

    if (!row.token_hash) {
      token = randomBytes(32).toString('hex');

      this.database.connection
        .prepare(
          'UPDATE local_grants SET token_hash=? WHERE owner=? AND client=? AND origin=? AND token_hash IS NULL',
        )
        .run(digest(token).toString('hex'), this.ownerId, clientId, origin);
    } else if (!token || !timingSafeEqual(digest(token), Buffer.from(row.token_hash, 'hex'))) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    return {
      lease: randomUUID(),
      handle: token!,
      ownerId: this.ownerId,
      deviceId: this.deviceId,
      clientId,
      origin,
    };
  }

  pending() {
    return (
      this.database.connection
        .prepare('SELECT client,origin FROM local_grants WHERE owner=? AND status=? AND expires_at>=?')
        .all(this.ownerId, LocalGrantStatus.Pending, Date.now()) as Pick<GrantRow, 'client' | 'origin'>[]
    ).map((row) => ({ clientId: row.client, origin: row.origin }));
  }

  approvedClient(clientId: string, origin: string) {
    return this.origins.includes(origin) && this.row(clientId, origin)?.status === LocalGrantStatus.Approved;
  }

  approve(clientId: string, origin: string) {
    if (!this.origins.includes(origin)) {
      throw new Error(ErrorCode.UNAUTHORIZED);
    }

    const result = this.database.connection
      .prepare(
        'UPDATE local_grants SET status=?,token_hash=NULL,expires_at=? WHERE owner=? AND client=? AND origin=? AND ((status=? AND expires_at>=?) OR status=?)',
      )
      .run(
        LocalGrantStatus.Approved,
        Date.now() + LOCAL_LIMITS.pendingGrantExpiryMs,
        this.ownerId,
        clientId,
        origin,
        LocalGrantStatus.Pending,
        Date.now(),
        LocalGrantStatus.Revoked,
      );

    if (!result.changes) {
      throw new Error(ErrorCode.NOT_FOUND);
    }
  }

  revoke(clientId: string) {
    this.database.connection
      .prepare('UPDATE local_grants SET status=?,token_hash=NULL WHERE owner=? AND client=?')
      .run(LocalGrantStatus.Revoked, this.ownerId, clientId);
  }

  current(principal: LocalPrincipal) {
    if (
      principal.ownerId !== this.ownerId ||
      principal.deviceId !== this.deviceId ||
      !this.origins.includes(principal.origin)
    ) {
      return false;
    }

    const row = this.row(principal.clientId, principal.origin);

    return (
      row?.status === LocalGrantStatus.Approved &&
      !!row.token_hash &&
      timingSafeEqual(digest(principal.handle), Buffer.from(row.token_hash, 'hex'))
    );
  }
}
