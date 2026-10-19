import { ErrorCode, LOCAL_LIMITS } from '@protocol';

export class BrokerPending {
  private entries = new Map<string, ReturnType<typeof setTimeout>>();
  private retired = new Set<string>();

  constructor(private expire: (id: string) => void) {}

  add(id: string) {
    if (
      this.entries.size >= LOCAL_LIMITS.maxPendingRequests ||
      this.entries.has(id) ||
      this.retired.has(id)
    ) {
      throw new Error(ErrorCode.INVALID_REQUEST);
    }

    this.entries.set(
      id,
      setTimeout(() => {
        this.remove(id);
        this.expire(id);
      }, LOCAL_LIMITS.requestTimeoutMs),
    );
  }

  private remove(id: string) {
    clearTimeout(this.entries.get(id));
    this.entries.delete(id);
    this.retired.add(id);

    if (this.retired.size > LOCAL_LIMITS.maxPendingRequests * 2) {
      this.retired.delete(this.retired.values().next().value!);
    }
  }

  consume(id: string) {
    if (!this.entries.has(id)) {
      if (this.retired.has(id)) {
        return false;
      }

      throw new Error(ErrorCode.INVALID_FRAME);
    }

    this.remove(id);

    return true;
  }

  clear() {
    for (const timer of this.entries.values()) {
      clearTimeout(timer);
    }

    this.entries.clear();
    this.retired.clear();
  }
}
