import { useState } from "react"
import { AgentProvider, ProfileAction, ProfileAuthMode, ProfileRequestKind } from "@protocol"
import type { ProfileCreateFormProps } from "@/pages/accounts/ui/management/profile-create-form.types"
import { PROFILE_PROVIDERS } from "@/pages/accounts/config/profile/providers"

export function useProfileCreate(submit: ProfileCreateFormProps["submit"]) {
  const [label, setLabel] = useState("")
  const [authMode, setAuthMode] = useState<ProfileAuthMode>(ProfileAuthMode.Subscription)
  const [provider, setProvider] = useState<AgentProvider>(AgentProvider.Codex)
  const supported = PROFILE_PROVIDERS.find((entry) => entry.id === provider)?.available === true

  async function create() {
    if (!supported) return null

    const result = await submit({
      kind: ProfileRequestKind.Mutate,
      mutation: {
        action: ProfileAction.Create,
        operationId: crypto.randomUUID(),
        input: { label: label.trim(), provider, authMode },
      },
    })

    if (result) setLabel("")
  }

  return { label, setLabel, authMode, setAuthMode, provider, setProvider, supported, create }
}
