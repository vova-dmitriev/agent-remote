import type { Plugin } from 'vite';

export function extensionNoEval(): Plugin {
  return {
    name: 'extension-zod-no-eval',
    enforce: 'pre',
    transform(source, id) {
      if (/\/zod\/v4\/core\/util\.js$/.test(id)) {
        const start = source.indexOf('export const allowsEval =');
        const end = source.indexOf('export function isPlainObject', start);

        if (start < 0 || end < 0) {
          throw new Error('Unsupported Zod no-eval build shape');
        }

        return {
          code: source.slice(0, start) + 'export const allowsEval = { value: false };\n' + source.slice(end),
          map: null,
        };
      }

      if (/\/zod\/v4\/core\/schemas\.js$/.test(id)) {
        const marker = 'const jit = !core.globalConfig.jitless;';

        if (!source.includes(marker)) {
          throw new Error('Unsupported Zod jitless build shape');
        }

        return { code: source.replace(marker, 'const jit = false;'), map: null };
      }

      return null;
    },
  };
}
