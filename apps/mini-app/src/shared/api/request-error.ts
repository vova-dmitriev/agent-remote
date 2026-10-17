import { ErrorCode } from "@protocol"

const statusCodes: Record<number, string> = {
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.ACCESS_DENIED,
  404: ErrorCode.NOT_FOUND,
  408: ErrorCode.REQUEST_TIMEOUT,
  413: ErrorCode.PROMPT_TOO_LARGE,
  429: ErrorCode.RATE_LIMITED,
}

export async function fetchResponse(url: string, options: RequestInit) {
  try {
    return await fetch(url, options)
  } catch (error) {
    throw new Error(
      error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)
        ? ErrorCode.REQUEST_TIMEOUT
        : ErrorCode.NETWORK_UNAVAILABLE,
    )
  }
}

export async function responseError(response: Response) {
  const body: unknown = await response.json().catch(() => null)
  const code = body && typeof body === "object" && "code" in body && typeof body.code === "string" ? body.code : undefined
  const fallback = statusCodes[response.status] ?? (response.status >= 500 ? ErrorCode.SERVICE_UNAVAILABLE : ErrorCode.REQUEST_FAILED)

  return Object.assign(new Error(code || fallback), { status: response.status })
}

export async function requestJson<T>(
  url: string,
  options: RequestInit,
  requests: Set<AbortController>,
  observe?: (response: Response) => void,
): Promise<T> {
  const controller = new AbortController()

  requests.add(controller)
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetchResponse(url, { ...options, signal: controller.signal })

    if (!response.ok) throw await responseError(response)
    observe?.(response)

    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
    requests.delete(controller)
  }
}
