import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig, mergeConfig } from "vite"
// Vite's config loader does not resolve tsconfig paths, so this file reaches the extension config relatively.
// eslint-disable-next-line no-restricted-imports
import { EXTENSION_ICON_SIZES, extensionManifestFor, serverOrigin } from "../chrome-extension/src/config/manifest.ts"
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

          for (const size of EXTENSION_ICON_SIZES)
            this.emitFile({
              type: "asset",
              fileName: `assets/icon-${size}.png`,
              source: readFileSync(new URL(`../chrome-extension/assets/icon-${size}.png`, import.meta.url)),
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
