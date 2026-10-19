import { mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile } from 'vite';
import { verifyArtifact } from './verify-artifact.mjs';
import { checkExtensionSource } from './check-source.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));

export async function buildExtension(outDir = resolve(repository, 'dist/chrome-extension')) {
  process.env.NODE_ENV = 'production';
  const output = resolve(outDir);
  const miniApp = resolve(repository, 'dist/mini-app');
  const separation = relative(output, miniApp);
  const nested = relative(miniApp, output);

  if (
    !separation ||
    (!separation.startsWith('..') && !isAbsolute(separation)) ||
    (!nested.startsWith('..') && !isAbsolute(nested))
  ) {
    throw new Error('Extension output must be separate from the Mini App output');
  }

  checkExtensionSource(repository);
  mkdirSync(output, { recursive: true });

  const configuration = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    resolve(repository, 'apps/mini-app/vite.extension.config.ts'),
  );

  if (!configuration) {
    throw new Error('Extension build configuration unavailable');
  }

  await build({
    configFile: resolve(repository, 'apps/mini-app/vite.extension.config.ts'),
    root: resolve(repository, 'apps/mini-app'),
    build: { outDir: output },
  });

  await build({
    configFile: false,
    plugins: configuration.config.plugins.filter((plugin) => plugin?.name === 'extension-zod-no-eval'),
    resolve: {
      alias: [
        {
          find: '@protocol/private',
          replacement: resolve(repository, 'packages/protocol/src/errors/private-error-codes.ts'),
        },
        { find: /^@protocol$/, replacement: resolve(repository, 'packages/protocol/src/index.ts') },
        { find: '@transport', replacement: resolve(repository, 'packages/transport/src') },
      ],
    },
    build: {
      outDir: output,
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: resolve(repository, 'apps/chrome-extension/src/background/main.ts'),
        formats: ['es'],
        fileName: () => 'background.js',
      },
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });

  verifyArtifact(output);

  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.length && (args.length !== 2 || args[0] !== '--outDir')) {
    throw new Error('Usage: node scripts/extension/build.mjs [--outDir directory]');
  }

  await buildExtension(args[1]);
}
