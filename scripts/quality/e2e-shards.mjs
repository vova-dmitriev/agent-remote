import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';

/**
 * Runs the Playwright suite as parallel shards. Every e2e test starts its own relay on one port behind one Vite dev
 * server, so a single run is serial; each shard gets its own app and relay ports instead. Extra arguments go to every
 * shard. `E2E_SHARDS` overrides the shard count.
 */
const SHARDS = Number(
  process.env.E2E_SHARDS ?? Math.max(1, Math.min(8, Math.floor(availableParallelism() / 2))),
);

// Shard n uses base + n - 1, so a single shard keeps ports set through E2E_APP_PORT and E2E_RELAY_PORT.
const APP_PORT_BASE = Number(process.env.E2E_APP_PORT ?? 4200);
const RELAY_PORT_BASE = Number(process.env.E2E_RELAY_PORT ?? 3100);

function shard(index) {
  return new Promise((resolve) => {
    const output = [];

    const child = spawn(
      'npx',
      [
        'playwright',
        'test',
        `--shard=${index}/${SHARDS}`,
        `--output=test-results/shard-${index}`,
        ...process.argv.slice(2),
      ],
      {
        env: {
          ...process.env,
          E2E_APP_PORT: String(APP_PORT_BASE + index - 1),
          E2E_RELAY_PORT: String(RELAY_PORT_BASE + index - 1),
        },
      },
    );

    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => output.push(chunk));

    child.on('close', (code) =>
      resolve({ index, code: code ?? 1, output: Buffer.concat(output).toString() }),
    );
  });
}

const started = Date.now();
const results = await Promise.all(Array.from({ length: SHARDS }, (_, index) => shard(index + 1)));

for (const { index, code, output } of results) {
  process.stdout.write(`\n=== e2e shard ${index}/${SHARDS} (exit ${code})\n${output}`);
}

process.stdout.write(`\ne2e: ${SHARDS} shards in ${Math.round((Date.now() - started) / 1000)}s\n`);
process.exit(results.some((result) => result.code !== 0) ? 1 : 0);
