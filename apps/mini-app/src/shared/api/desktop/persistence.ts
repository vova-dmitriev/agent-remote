import { z } from "zod"
import {
  ErrorCode,
  LocalOperation,
  attachmentSchema,
  clientCommandSchema,
  resultSchema,
  type AttachmentDescriptor,
  type ClientCommand,
} from "@protocol"
import type { ApplicationPersistence } from "../application-client.js"
import type { DesktopBridgeConnection } from "./desktop-connection.js"

const draftSchema = z.strictObject({ revision: z.number().int().nonnegative(), text: z.string(), attachments: z.array(attachmentSchema) })
const queueSchema = z.strictObject({ revision: z.number().int().nonnegative(), intents: z.array(clientCommandSchema) })

export class DesktopPersistence implements ApplicationPersistence {
  constructor(private readonly connection: DesktopBridgeConnection) {}

  async readDraft(sessionId: string) {
    return draftSchema.parse(await this.connection.request({ operation: LocalOperation.DraftGet, sessionId }))
  }

  async saveDraft(sessionId: string, generation: string, revision: number, text: string, attachments: AttachmentDescriptor[]) {
    return draftSchema.parse(
      await this.connection.request({ operation: LocalOperation.DraftSave, sessionId, generation, revision, text, attachments }),
    )
  }

  async readQueue(sessionId: string) {
    return queueSchema.parse(await this.connection.request({ operation: LocalOperation.QueueGet, sessionId }))
  }

  async saveQueue(sessionId: string, generation: string, revision: number, intents: ClientCommand[]) {
    return queueSchema.parse(
      await this.connection.request({ operation: LocalOperation.QueueSave, sessionId, generation, revision, intents }),
    )
  }

  async readReceipt(commandId: string) {
    try {
      return resultSchema.parse(await this.connection.request({ operation: LocalOperation.Receipt, commandId }))
    } catch (error) {
      if (error instanceof Error && error.message === ErrorCode.NOT_FOUND) return null

      throw error
    }
  }
}
