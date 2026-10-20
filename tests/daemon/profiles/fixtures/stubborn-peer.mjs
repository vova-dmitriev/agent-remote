import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

writeFileSync(join(process.env.CODEX_HOME, 'native-peer.pid'), String(process.pid), { mode: 0o600 });
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
await import('./native-peer.mjs');
