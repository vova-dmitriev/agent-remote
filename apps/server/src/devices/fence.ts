/** Serializes authentication replacement, mutation and revoke for one device. */
export class DeviceFence {
  private pending = new Map<string, Promise<unknown>>();
  run<T>(deviceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(deviceId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation); // ignore: the previous operation's caller handles its failure

    this.pending.set(deviceId, next);

    const release = () => {
      if (this.pending.get(deviceId) === next) {
        this.pending.delete(deviceId);
      }
    };

    void next.then(release, release);

    return next;
  }
  async drain() {
    await Promise.allSettled([...this.pending.values()]);
  }
}
