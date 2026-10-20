import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const repositoryRequire = createRequire(new URL('../../../package.json', import.meta.url));

const forgeConfig = repositoryRequire('./apps/desktop/forge.config.cjs') as {
  packagerConfig: {
    name: string;
    icon: string;
    asar: boolean;
    extraResource: string[];
    ignore: RegExp[];
    prune?: boolean;
  };
  hooks?: { postPackage?: (...args: unknown[]) => Promise<void> };
};

const rootPackage = repositoryRequire('./package.json') as {
  scripts: Record<string, string>;
};

const desktopPackage = repositoryRequire('./apps/desktop/package.json') as {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('desktop packaging configuration', () => {
  it('copies the verified companion into the resources root under its expected name', () => {
    const resources = forgeConfig.packagerConfig.extraResource;

    expect(forgeConfig.packagerConfig.asar).toBe(true);
    expect(resources).toEqual(['dist/desktop-companion']);
    expect(basename(resources[0]!)).toBe('desktop-companion');
    expect(forgeConfig.packagerConfig.prune).toBe(false);
    expect(desktopPackage.dependencies ?? {}).toEqual({});
    expect(typeof forgeConfig.hooks?.postPackage).toBe('function');

    const ignored = (path: string) => forgeConfig.packagerConfig.ignore.some((pattern) => pattern.test(path));

    expect(ignored('/dist/desktop-companion/runtime-manifest.json')).toBe(true);
    expect(ignored('/node_modules/@scope/module')).toBe(true);

    for (const path of ['/dist/main/index.cjs', '/dist/preload/bridge.cjs', '/dist/renderer/desktop.html']) {
      expect(ignored(path), path).toBe(false);
    }

    expect(join('/packaged/resources', basename(resources[0]!))).toBe(
      '/packaged/resources/desktop-companion',
    );
  });

  it('names the app and ships the icon', async () => {
    expect(forgeConfig.packagerConfig.name).toBe('Agent Remote');

    await expect(
      readFile(new URL(`../../../apps/desktop/${forgeConfig.packagerConfig.icon}.icns`, import.meta.url)),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it('does not ask Forge to rebuild the standalone runtime native addons for Electron', () => {
    for (const dependency of ['better-sqlite3', 'node-pty']) {
      expect(desktopPackage.dependencies?.[dependency]).toBeUndefined();
      expect(desktopPackage.devDependencies?.[dependency]).toBeUndefined();
    }
  });

  it('runs the root build from the repository before desktop packaging', () => {
    expect(desktopPackage.scripts.package).toMatch(/^npm --prefix \.\.\/\.\. run build && /);
    expect(desktopPackage.scripts.package).toContain('node ../../scripts/desktop/build.mjs');
    expect(desktopPackage.scripts.package).toContain('node ../../scripts/desktop/package.mjs');
    expect(rootPackage.scripts['package:desktop']).toBe('npm --prefix apps/desktop run package');
    expect(rootPackage.scripts['validate:commit']).toContain('npm run build:desktop');
  });

  it('keeps new desktop documentation inside repository format validation', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['format:repository:check']).toContain('docs/accounts-and-keys.md');
    expect(packageJson.scripts['format:repository:check']).toContain('docs/desktop.md');
  });
});
