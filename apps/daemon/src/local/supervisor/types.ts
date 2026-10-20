export interface CompanionRuntime {
  nodePath: string;
  entryPath: string;
  nodeSha256: string;
  entrySha256: string;
}
export interface CompanionHealth {
  protocolVersion: number;
  instanceId: string;
  /** Reported by companions that know it; older ones omit both. */
  pid?: number | undefined;
  entry?: string | undefined;
}
export interface EnsureCompanionOptions {
  directory: string;
  runtime: CompanionRuntime;
  probe: () => Promise<CompanionHealth | null>;
  timeoutMs?: number;
  /** Desktop companion only: also accept Claude hooks on the CLI default socket. */
  legacyClaudeHooks?: boolean;
  /**
   * Desktop companion only, whose directory belongs to one app: a companion running from another runtime (an older
   * build) is stopped and replaced instead of reused.
   */
  replaceOtherBuild?: boolean;
}
