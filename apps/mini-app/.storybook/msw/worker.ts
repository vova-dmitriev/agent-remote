import { setupWorker } from "msw/browser"
import { handlers } from "./handlers"

let started: ReturnType<typeof start> | undefined

async function start() {
  const worker = setupWorker(...handlers)

  await worker.start({
    quiet: true,
    onUnhandledRequest(request, print) {
      if (request.url.startsWith("http://api.storybook.local")) print.error()
    },
  })

  return worker
}

export function startWorker() {
  return (started ??= start())
}
