import { useState } from "react"
import { ProfileRequestKind, ProfileOperationPhase } from "@protocol"
import { enrollProfile } from "@/pages/accounts/lib/enrollment/enroll-profile"
import type { ProfileEnrollmentProps } from "@/pages/accounts/ui/enrollment/profile-enrollment.types"

export function useProfileEnrollment({ profile, perform }: ProfileEnrollmentProps) {
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState("")
  const [pin, setPin] = useState("")

  async function submit() {
    const credential = secret

    setSecret("")
    const result = await perform((send) => enrollProfile(send, profile, credential, pin))

    if (result?.kind === ProfileRequestKind.CompleteEnrollment && result.data.phase === ProfileOperationPhase.Complete) setOpen(false)
  }

  function toggle() {
    setSecret("")
    setOpen((value) => !value)
  }

  return { open, secret, setSecret, pin, setPin, submit, toggle }
}
