import { ErrorCode, HttpStatus } from "@protocol"

const statusCodes: Record<number, string> = {
  [HttpStatus.Unauthorized]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.Forbidden]: ErrorCode.ACCESS_DENIED,
  [HttpStatus.NotFound]: ErrorCode.NOT_FOUND,
  [HttpStatus.RequestTimeout]: ErrorCode.REQUEST_TIMEOUT,
  [HttpStatus.PayloadTooLarge]: ErrorCode.PROMPT_TOO_LARGE,
  [HttpStatus.TooManyRequests]: ErrorCode.RATE_LIMITED,
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

  const fallback =
    statusCodes[response.status] ??
    (response.status >= HttpStatus.InternalServerError ? ErrorCode.SERVICE_UNAVAILABLE : ErrorCode.REQUEST_FAILED)

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
