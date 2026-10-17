export const appPort = Number(process.env.E2E_APP_PORT ?? 4173);

if (!Number.isInteger(appPort) || appPort < 1024 || appPort > 65535)
  throw new Error('INVALID_E2E_APP_PORT');

export const appOrigin = `http://127.0.0.1:${appPort}`;
