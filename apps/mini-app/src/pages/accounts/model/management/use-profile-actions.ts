import { useState } from "react"
import { ProfileAction, ProfileRequestKind } from "@protocol"
import type { ProfileActionsProps } from "@/pages/accounts/ui/management/profile-actions.types"

export function useProfileActions({ profile, run }: ProfileActionsProps) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(profile.label)

  function rename() {
    setLabel(profile.label)
    setEditing(true)
  }

  async function save() {
    const result = await run({
      kind: ProfileRequestKind.Mutate,
      mutation: {
        action: ProfileAction.Rename,
        operationId: crypto.randomUUID(),
        profileId: profile.id,
        expectedVersion: profile.version,
        label: label.trim(),
      },
    })

    if (result) setEditing(false)
  }

  function mutation(
    action: typeof ProfileAction.Disable | typeof ProfileAction.Enable | typeof ProfileAction.SetDefault | typeof ProfileAction.Remove,
  ) {
    return run({
      kind: ProfileRequestKind.Mutate,
      mutation: { action, operationId: crypto.randomUUID(), profileId: profile.id, expectedVersion: profile.version },
    })
  }

  function authenticate(action: typeof ProfileAction.Check | typeof ProfileAction.SignIn) {
    return run({
      kind: ProfileRequestKind.Authenticate,
      input: { action, operationId: crypto.randomUUID(), profileId: profile.id, expectedVersion: profile.version },
    })
  }

  return { editing, label, setLabel, rename, save, cancel: () => setEditing(false), mutation, authenticate }
}
