import { fileURLToPath } from "node:url"
import { defineConfig, mergeConfig } from "vite"
import { extensionManifest } from "../chrome-extension/src/config/manifest.ts"
import sharedConfig from "./vite.config.ts"
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
            source: JSON.stringify(extensionManifest, null, 2) + "\n",
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
