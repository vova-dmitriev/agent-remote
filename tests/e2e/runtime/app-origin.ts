export const DEFAULT_E2E_APP_PORT = 4173;
export const DEFAULT_E2E_RELAY_PORT = 3000;
export const E2E_RELAY_ORIGIN_ENV = 'DEV_RELAY_ORIGIN';
/** Set by the sharded runner after it builds the app: shards serve that build instead of each running a dev server. */
export const E2E_PREVIEW_ENV = 'E2E_PREVIEW';

function readPort(name: string, fallback: number) {
  const port = Number(process.env[name] ?? fallback);

  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`INVALID_${name}`);

  return port;
}

export const appPort = readPort('E2E_APP_PORT', DEFAULT_E2E_APP_PORT);
export const relayPort = readPort('E2E_RELAY_PORT', DEFAULT_E2E_RELAY_PORT);

if (relayPort === appPort) throw new Error('E2E_RELAY_PORT_EQUALS_APP_PORT');

export const appOrigin = `http://127.0.0.1:${appPort}`;
export const relayOrigin = `http://127.0.0.1:${relayPort}`;
export const relaySocketOrigin = `ws://127.0.0.1:${relayPort}`;
