import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { entries: ["index.html"], include: ["libsodium-wrappers"] },
  resolve: {
    alias: {
      "@storybook-fixtures": fileURLToPath(new URL("./.storybook/fixtures", import.meta.url)),
      "@storybook-components": fileURLToPath(new URL("./.storybook/components", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@transport": fileURLToPath(new URL("../../packages/transport/src", import.meta.url)),
      "@protocol": fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url)),
    },
  },
  build: { outDir: "../../dist/mini-app", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/auth": "http://127.0.0.1:3000",
      "/pair": "http://127.0.0.1:3000",
      "/devices": "http://127.0.0.1:3000",
      "/sessions": "http://127.0.0.1:3000",
      "/commands": "http://127.0.0.1:3000",
      "/preferences": "http://127.0.0.1:3000",
      "/ws": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
})
