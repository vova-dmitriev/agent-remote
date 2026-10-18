import { fileURLToPath } from "node:url"
import { defineConfig, mergeConfig } from "vite"
import sharedConfig from "./vite.config.ts"

const config = mergeConfig(
  sharedConfig,
  defineConfig({
    base: "./",
    root: fileURLToPath(new URL("./", import.meta.url)),
    build: {
      outDir: "../../dist/desktop",
      emptyOutDir: true,
      rollupOptions: {
        input: { desktop: fileURLToPath(new URL("./desktop.html", import.meta.url)) },
      },
    },
  }),
)

export default defineConfig({ ...config, optimizeDeps: { ...config.optimizeDeps, entries: ["desktop.html"] } })
