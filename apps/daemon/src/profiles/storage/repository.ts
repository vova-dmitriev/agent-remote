import { immutableProfileScope } from './scope.js';
import {
  ErrorCode,
  ProfileStatus,
  ProfileLimits,
  executionProfileSummarySchema,
  type ExecutionProfileSummary,
  type AgentProvider,
} from '@protocol';
import type { LocalDatabase } from '../../local/state/database.js';
import type { ProfileScope } from '../types.js';

export class ProfileRepository {
  constructor(
    private database: LocalDatabase,
    private scope: ProfileScope,
  ) {
    this.scope = immutableProfileScope(scope);

    database.connection.exec(`
      CREATE TABLE IF NOT EXISTS execution_profiles(id TEXT PRIMARY KEY,owner TEXT NOT NULL,device TEXT NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS execution_profile_scope ON execution_profiles(owner,device);
      CREATE TABLE IF NOT EXISTS execution_profile_defaults(owner TEXT NOT NULL,device TEXT NOT NULL,provider TEXT NOT NULL,profile TEXT NOT NULL,PRIMARY KEY(owner,device,provider));
    `);
  }

  private decode(row: unknown): ExecutionProfileSummary {
    const { value } = row as { value: string };
    const profile = executionProfileSummarySchema.parse(JSON.parse(value));

    if (profile.ownerId !== this.scope.ownerId || profile.deviceId !== this.scope.deviceId) {
      throw new Error(ErrorCode.NOT_FOUND);
    }

    return profile;
  }

  get(id: string) {
    const row = this.database.connection
      .prepare('SELECT value FROM execution_profiles WHERE owner=? AND device=? AND id=?')
      .get(this.scope.ownerId, this.scope.deviceId, id);

    if (!row) {
      throw new Error(ErrorCode.NOT_FOUND);
    }

    return this.decode(row);
  }

  list() {
    return this.database.connection
      .prepare('SELECT value FROM execution_profiles WHERE owner=? AND device=? AND status<>? ORDER BY rowid')
      .all(this.scope.ownerId, this.scope.deviceId, ProfileStatus.Removed)
      .map((row) => this.decode(row));
  }

  create(profile: ExecutionProfileSummary) {
    return this.database.connection.transaction(() => {
      const count = this.database.connection
        .prepare(
          'SELECT COUNT(*) AS total,COUNT(CASE WHEN status<>? THEN 1 END) AS active FROM execution_profiles WHERE owner=? AND device=?',
        )
        .get(ProfileStatus.Removed, this.scope.ownerId, this.scope.deviceId) as {
        total: number;
        active: number;
      };

      if (count.active >= ProfileLimits.ActiveProfiles || count.total >= ProfileLimits.RetainedProfiles) {
        throw new Error(ErrorCode.PROFILE_LIMIT_REACHED);
      }

      this.database.connection
        .prepare(
          'INSERT INTO execution_profiles(id,owner,device,provider,status,version,value) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          profile.id,
          this.scope.ownerId,
          this.scope.deviceId,
          profile.provider,
          profile.status,
          profile.version,
          JSON.stringify(profile),
        );

      return profile;
    })();
  }

  save(profile: ExecutionProfileSummary, expectedVersion: number) {
    return this.database.connection.transaction(() => {
      const result = this.database.connection
        .prepare(
          'UPDATE execution_profiles SET status=?,version=?,value=? WHERE owner=? AND device=? AND id=? AND version=?',
        )
        .run(
          profile.status,
          profile.version,
          JSON.stringify(profile),
          this.scope.ownerId,
          this.scope.deviceId,
          profile.id,
          expectedVersion,
        );

      if (result.changes !== 1) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      if (profile.status !== ProfileStatus.Ready) {
        this.clearDefault(profile.id);
      }

      return profile;
    })();
  }

  defaultFor(provider: AgentProvider) {
    const row = this.database.connection
      .prepare('SELECT profile FROM execution_profile_defaults WHERE owner=? AND device=? AND provider=?')
      .get(this.scope.ownerId, this.scope.deviceId, provider) as { profile: string } | undefined;

    return row ? this.get(row.profile) : null;
  }

  setDefault(profile: ExecutionProfileSummary) {
    this.database.connection.transaction(() => {
      if (this.get(profile.id).version !== profile.version) {
        throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
      }

      this.database.connection
        .prepare(
          'INSERT INTO execution_profile_defaults(owner,device,provider,profile) VALUES(?,?,?,?) ON CONFLICT(owner,device,provider) DO UPDATE SET profile=excluded.profile',
        )
        .run(this.scope.ownerId, this.scope.deviceId, profile.provider, profile.id);
    })();
  }

  private clearDefault(id: string) {
    this.database.connection
      .prepare('DELETE FROM execution_profile_defaults WHERE owner=? AND device=? AND profile=?')
      .run(this.scope.ownerId, this.scope.deviceId, id);
  }
}
