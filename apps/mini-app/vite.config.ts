import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"

// Dev proxy target; the e2e harness overrides it (E2E_RELAY_PORT) through this variable.
const relayOrigin = process.env.DEV_RELAY_ORIGIN ?? "http://127.0.0.1:3000"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { entries: ["index.html"], include: ["libsodium-wrappers"] },
  resolve: {
    alias: [
      {
        find: "@protocol/private",
        replacement: fileURLToPath(new URL("../../packages/protocol/src/errors/private-error-codes.ts", import.meta.url)),
      },
      { find: /^@protocol$/, replacement: fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url)) },
      { find: "@transport", replacement: fileURLToPath(new URL("../../packages/transport/src", import.meta.url)) },
      { find: "@storybook-fixtures", replacement: fileURLToPath(new URL("./.storybook/fixtures", import.meta.url)) },
      { find: "@storybook-components", replacement: fileURLToPath(new URL("./.storybook/components", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  build: { outDir: "../../dist/mini-app", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/auth": relayOrigin,
      "/pair": relayOrigin,
      "/devices": relayOrigin,
      "/sessions": relayOrigin,
      "/commands": relayOrigin,
      "/preferences": relayOrigin,
      "/ws": { target: relayOrigin.replace("http:", "ws:"), ws: true },
    },
  },
})
