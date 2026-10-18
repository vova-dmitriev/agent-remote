import { EventEmitter } from 'node:events';
import type { DeviceFrame } from '../../../../../packages/protocol/src/index.js';

export class NoRelay extends EventEmitter {
  connect() {}
  send(_frame: DeviceFrame) {
    return false;
  }
  close() {}
}
