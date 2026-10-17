import { mkdirSync, copyFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const target = new URL("../.storybook/public/", import.meta.url)

mkdirSync(fileURLToPath(target), { recursive: true })
copyFileSync(fileURLToPath(import.meta.resolve("msw/mockServiceWorker.js")), fileURLToPath(new URL("mockServiceWorker.js", target)))
