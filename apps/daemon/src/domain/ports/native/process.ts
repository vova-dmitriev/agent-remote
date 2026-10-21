/** Stable native process identity; no restart or filesystem authority is implied. */
export interface NativeProcess {
  pid: number;
  sessionId: string;
  cwd: string;
  procStart: string;
}

export interface NativeSkillsProcessPort {
  resolve(sessionId: string, cwd?: string): Promise<NativeProcess | undefined>;
  capture(expected: NativeProcess): Promise<{ args: string[]; env: Record<string, string> }>;
  cmuxSurface(pid: number): Promise<{ workspaceId: string; surfaceId: string } | undefined>;
}
