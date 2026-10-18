import { useState } from "react"

export function useAccountsLayout() {
  const [adding, setAdding] = useState(false)

  return { adding, toggleAdding: () => setAdding((value) => !value) }
}
