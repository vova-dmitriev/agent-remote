type RevocationListener = (tokenHashes: readonly string[]) => void;

/** Tells live connections that access tokens were revoked, so they can be closed immediately. */
export class SessionRevocations {
  private readonly listeners = new Set<RevocationListener>();

  subscribe(listener: RevocationListener) {
    this.listeners.add(listener);
  }

  publish(tokenHashes: readonly string[]) {
    for (const listener of this.listeners) {
      listener(tokenHashes);
    }
  }
}
