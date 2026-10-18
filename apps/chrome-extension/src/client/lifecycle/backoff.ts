import { RECONNECT_DELAYS_MS } from './values.js';

export class ReconnectBackoff {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private closed = false;

  schedule(connect: () => void) {
    const delay = RECONNECT_DELAYS_MS[this.attempts];

    if (this.closed || this.timer || delay === undefined) {
      return false;
    }

    ++this.attempts;

    this.timer = setTimeout(() => {
      this.timer = undefined;
      connect();
    }, delay);

    return true;
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
