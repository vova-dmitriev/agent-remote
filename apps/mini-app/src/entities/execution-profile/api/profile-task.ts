import type { ExecutionProfileAccess, ProfileResponse } from "@protocol"

export type ProfileTask = (send: ExecutionProfileAccess["request"]) => Promise<ProfileResponse>
export type ProfileTaskExecutor = (task: ProfileTask) => Promise<ProfileResponse | null>
