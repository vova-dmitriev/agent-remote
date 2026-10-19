import { z } from 'zod';
import {
  ErrorCode,
  LocalOperation,
  LOCAL_LIMITS,
  attachmentsSchema,
  clientCommandSchema,
  resultSchema,
  type AttachmentDescriptor,
  type ClientCommand,
} from '@protocol';
import type { ApplicationPersistence, PersistedDraft, PersistedQueue } from '@/shared/api';
import type { ExtensionConnection } from '../connection.js';

const revision = z.number().int().nonnegative();
const draftSchema = z.strictObject({ revision, text: z.string(), attachments: attachmentsSchema });

const queueSchema = z.strictObject({
  revision,
  intents: z.array(clientCommandSchema).max(LOCAL_LIMITS.queueLimit),
});

export class ExtensionPersistence implements ApplicationPersistence {
  constructor(private connection: ExtensionConnection) {}

  async readDraft(sessionId: string): Promise<PersistedDraft> {
    return draftSchema.parse(
      await this.connection.request({ operation: LocalOperation.DraftGet, sessionId }),
    );
  }

  async saveDraft(
    sessionId: string,
    generation: string,
    revision: number,
    text: string,
    attachments: AttachmentDescriptor[],
  ) {
    return draftSchema.parse(
      await this.connection.request({
        operation: LocalOperation.DraftSave,
        sessionId,
        generation,
        revision,
        text,
        attachments,
      }),
    );
  }

  async readQueue(sessionId: string): Promise<PersistedQueue> {
    return queueSchema.parse(
      await this.connection.request({ operation: LocalOperation.QueueGet, sessionId }),
    );
  }

  async saveQueue(sessionId: string, generation: string, revision: number, intents: ClientCommand[]) {
    return queueSchema.parse(
      await this.connection.request({
        operation: LocalOperation.QueueSave,
        sessionId,
        generation,
        revision,
        intents,
      }),
    );
  }

  async readReceipt(commandId: string) {
    try {
      return resultSchema.parse(
        await this.connection.request({ operation: LocalOperation.Receipt, commandId }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === ErrorCode.NOT_FOUND) {
        return null;
      }

      throw error;
    }
  }
}
