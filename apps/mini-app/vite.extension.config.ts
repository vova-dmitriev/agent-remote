import { fileURLToPath } from "node:url"
import { defineConfig, mergeConfig } from "vite"
// Vite's config loader does not resolve tsconfig paths, so this file reaches the extension config relatively.
// eslint-disable-next-line no-restricted-imports
import { extensionManifestFor, serverOrigin } from "../chrome-extension/src/config/manifest.ts"
import sharedConfig from "./vite.config.ts"
// eslint-disable-next-line no-restricted-imports
import { extensionNoEval } from "../chrome-extension/src/config/build.ts"

const config = mergeConfig(
  sharedConfig,
  defineConfig({
    base: "./",
    resolve: { alias: { "@extension": fileURLToPath(new URL("../chrome-extension/src", import.meta.url)) } },
    plugins: [
      extensionNoEval(),
      {
        name: "extension-manifest",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: JSON.stringify(extensionManifestFor(serverOrigin(process.env.VITE_EXTENSION_SERVER_ORIGIN)), null, 2) + "\n",
          })
        },
      },
    ],
    build: {
      outDir: "../../dist/chrome-extension",
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: fileURLToPath(new URL("./extension.html", import.meta.url)),
      },
    },
  }),
)

export default defineConfig({ ...config, optimizeDeps: { ...config.optimizeDeps, entries: ["extension.html"] } })
