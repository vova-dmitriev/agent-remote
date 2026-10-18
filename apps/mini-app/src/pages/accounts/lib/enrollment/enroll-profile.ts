import { ErrorCode, ProfileRequestKind, type ExecutionProfileSummary, type ExecutionProfileAccess } from "@protocol"

export async function enrollProfile(
  send: ExecutionProfileAccess["request"],
  profile: ExecutionProfileSummary,
  secret: string,
  pinnedKeyId: string,
) {
  try {
    const challenge = await send({
      kind: ProfileRequestKind.BeginEnrollment,
      input: {
        operationId: crypto.randomUUID(),
        profileId: profile.id,
        expectedVersion: profile.version,
        pinnedKeyId,
      },
    })

    if (
      challenge.kind !== ProfileRequestKind.BeginEnrollment ||
      challenge.data.profileId !== profile.id ||
      challenge.data.profileVersion !== profile.version ||
      challenge.data.deviceId !== profile.deviceId ||
      challenge.data.ownerId !== profile.ownerId
    ) {
      throw new Error(ErrorCode.ENROLLMENT_INVALID)
    }

    const { encryptEnrollment } = await import("@transport/credentials/sealed-box")
    const input = await encryptEnrollment(challenge.data, secret, pinnedKeyId)

    secret = ""

    return await send({ kind: ProfileRequestKind.CompleteEnrollment, input })
  } finally {
    secret = ""
  }
}
