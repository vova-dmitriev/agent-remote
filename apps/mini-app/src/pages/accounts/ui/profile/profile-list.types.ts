import type { ProfileList } from "@protocol"
import type { ProfileTaskExecutor } from "@/shared/api"
import type { ProfileCreateFormProps } from "../management/profile-create-form.types"

export interface ProfileListProps {
  data: ProfileList
  disabled: boolean
  run: ProfileCreateFormProps["submit"]
  perform: ProfileTaskExecutor
}
