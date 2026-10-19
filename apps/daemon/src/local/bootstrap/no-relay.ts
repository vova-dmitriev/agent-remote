import { EventEmitter } from 'node:events';
import type { DeviceFrame } from '@protocol';

export class NoRelay extends EventEmitter {
  connect() {}
  send(_frame: DeviceFrame) {
    return false;
  }
  close() {}
}
