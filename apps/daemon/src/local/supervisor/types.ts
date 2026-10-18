export interface CompanionRuntime {
  nodePath: string;
  entryPath: string;
  nodeSha256: string;
  entrySha256: string;
}
export interface CompanionHealth {
  protocolVersion: number;
  instanceId: string;
}
export interface EnsureCompanionOptions {
  directory: string;
  runtime: CompanionRuntime;
  probe: () => Promise<CompanionHealth | null>;
  timeoutMs?: number;
}
