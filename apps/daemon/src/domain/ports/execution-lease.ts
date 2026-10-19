export interface ExecutionOwnershipLease {
  readonly id: string;
  bindSocket(path: string): void;
  bindProcess(pid: number): void;
  processId(): number | undefined;
  markReady(): void;
  releaseBeforeLaunch(): boolean;
  releaseAfterExit(): boolean;
}
