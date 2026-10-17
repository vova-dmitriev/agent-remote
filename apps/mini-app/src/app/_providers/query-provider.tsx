import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ProviderProps } from "./provider.types"

export function QueryProvider({ children }: ProviderProps) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } }),
  )

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
