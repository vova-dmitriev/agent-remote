import { z } from "zod"
import { ErrorCode, ProfileRequestKind, ProfileOperationPhase, knownErrorCode, type ProfileRequest, type ProfileResponse } from "@protocol"
import { PROFILE_OPERATION_STORAGE_PREFIX } from "@/pages/accounts/config/management/operation-journal"

// Only an opaque operation ID is retained. Never persist requests, keys, ciphertext or login URLs.
export class ProfileOperationJournal {
  private key: string

  constructor(
    deviceId: string,
    private storage: Storage,
  ) {
    this.key = PROFILE_OPERATION_STORAGE_PREFIX + deviceId
  }

  pending() {
    const value = this.storage.getItem(this.key)

    return z.uuid().safeParse(value).success ? value : null
  }

  async request(send: (input: ProfileRequest) => Promise<ProfileResponse>, input: ProfileRequest) {
    const id = this.writeId(input)
    const pending = this.pending()

    if (id && pending && pending !== id) throw new Error(ErrorCode.UNKNOWN_AFTER_WRITE)
    if (id) this.storage.setItem(this.key, id)

    try {
      const response = await send(input)

      const terminal =
        "phase" in response.data &&
        (response.data.phase === ProfileOperationPhase.Complete || response.data.phase === ProfileOperationPhase.Failed)

      if (id || (terminal && "id" in response.data && response.data.id === pending)) {
        if (this.pending() === (id ?? pending)) this.storage.removeItem(this.key)
      }

      return response
    } catch (error) {
      if (input.kind === ProfileRequestKind.Reconcile && input.operationId === pending && knownErrorCode(error) === ErrorCode.NOT_FOUND) {
        if (this.pending() === pending) this.storage.removeItem(this.key)
      }

      throw error
    }
  }

  private writeId(input: ProfileRequest) {
    switch (input.kind) {
      case ProfileRequestKind.Mutate:
        return input.mutation.operationId
      case ProfileRequestKind.Authenticate:
      case ProfileRequestKind.BeginEnrollment:
      case ProfileRequestKind.CompleteEnrollment:
        return input.input.operationId
      default:
        return null
    }
  }
}
