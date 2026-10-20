import { fileURLToPath } from "node:url"
import { mergeConfig, type UserConfig } from "vite"
import shared from "./vite.config"

// The shared config is a plain object.
const config = shared as UserConfig

/**
 * The e2e build: both browser entries bundled once and served by `vite preview` behind the dev proxy, so parallel e2e
 * shards do not each transform the source on demand.
 */
const e2e: UserConfig = {
  build: {
    outDir: fileURLToPath(new URL("../../test-results/e2e-app", import.meta.url)),
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        desktop: fileURLToPath(new URL("./desktop.html", import.meta.url)),
      },
    },
  },
  preview: { host: "127.0.0.1", proxy: config.server?.proxy ?? {} },
}

export default mergeConfig(config, e2e)
