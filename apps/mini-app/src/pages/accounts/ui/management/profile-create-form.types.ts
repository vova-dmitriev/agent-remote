import type { ProfileRequest, ProfileResponse } from "@protocol"

export interface ProfileCreateFormProps {
  disabled: boolean
  submit: (request: ProfileRequest) => Promise<ProfileResponse | null>
}
