import { runCli } from '../setup-cli.js';

try {
  await runCli();
} catch (error) {
  process.stderr.write(
    (error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
      ? error.message
      : 'LOCAL_OPERATION_FAILED') + '\n',
  );

  process.exitCode = 1;
}
