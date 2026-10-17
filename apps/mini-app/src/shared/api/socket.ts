import { FrameType } from "@protocol"

export function createAppSocket(origin: string, token: () => string) {
  const url = new URL("/ws/app", origin || window.location.origin)

  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  const socket = new WebSocket(url)

  socket.onopen = () => socket.send(JSON.stringify({ type: FrameType.Auth, token: token() }))

  socket.onerror = () => {}

  return socket
}
