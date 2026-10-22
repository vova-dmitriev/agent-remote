import { z } from 'zod';
import {
  ErrorCode,
  LocalOperation,
  accountPreferencesSchema,
  readingPositionSchema,
  sessionFileSchema,
  analyticsReportSchema,
  rulesReplySchema,
  type RulesRequest,
  type AnalyticsQuery,
  type PreferencePatch,
  type ReadingPosition,
  type SessionRemoval,
  type ModelChoice,
  type ProjectSession,
  projectSessionReplySchema,
} from '@protocol';
import { chromeApi } from '../config/chrome-api.js';
import { ExtensionConfig } from '../config/values.js';
import type { ExtensionConnection } from './connection.js';

const bookmarkSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  position: readingPositionSchema.nullable(),
});

export class ExtensionOperations {
  private bookmarks = new Map<string, z.infer<typeof bookmarkSchema>>();
  private saves = new Set<string>();

  constructor(protected connection: ExtensionConnection) {}

  async getPreferences() {
    return accountPreferencesSchema.parse(
      await this.connection.request({ operation: LocalOperation.PreferencesGet }),
    );
  }

  async savePreferences(patch: PreferencePatch) {
    const preferences = accountPreferencesSchema.parse(
      await this.connection.request({ operation: LocalOperation.PreferencesSave, patch }),
    );

    if (preferences.language) {
      await chromeApi()?.storage.local.set({ [ExtensionConfig.LanguageKey]: preferences.language });
    }

    return preferences;
  }

  renameSession(sessionId: string, title: string, generation: string) {
    return this.connection.request({ operation: LocalOperation.Rename, sessionId, title, generation });
  }

  pinSession(sessionId: string, generation: string, pinned: boolean) {
    return this.connection.request({ operation: LocalOperation.Pin, sessionId, generation, pinned });
  }

  removeSession(sessionId: string, generation: string, mode: SessionRemoval) {
    return this.connection.request({ operation: LocalOperation.Remove, sessionId, generation, mode });
  }

  switchSessionModel(sessionId: string, generation: string, choice: ModelChoice) {
    return this.connection.request({ operation: LocalOperation.Model, sessionId, generation, choice });
  }

  async createProjectSession(_deviceId: string, session: ProjectSession) {
    return projectSessionReplySchema.parse(
      await this.connection.request({ operation: LocalOperation.Create, session }),
    );
  }

  async readSessionFile(sessionId: string, generation: string, path: string) {
    return sessionFileSchema.parse(
      await this.connection.request({ operation: LocalOperation.File, sessionId, generation, path }),
    );
  }

  /** The paired companion's device keeps the rules. */
  async rules(_deviceId: string, request: RulesRequest) {
    return rulesReplySchema.parse(
      await this.connection.request({ operation: LocalOperation.Rules, request }),
    );
  }

  /** The paired companion's device: the report is counted on that Mac. */
  async usageReport(_deviceId: string, query: AnalyticsQuery) {
    return analyticsReportSchema.parse(
      await this.connection.request({ operation: LocalOperation.Analytics, ...query }),
    );
  }

  async claimDevice(_code: string): Promise<never> {
    throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
  }
  async revokeDevice(_deviceId: string): Promise<never> {
    throw new Error(ErrorCode.CAPABILITY_UNAVAILABLE);
  }

  async getReadingPosition(sessionId: string) {
    const response = bookmarkSchema.parse(
      await this.connection.request({ operation: LocalOperation.ReadingGet, sessionId }),
    );

    this.bookmarks.set(sessionId, response);

    return { position: response.position };
  }

  async saveReadingPosition(sessionId: string, position: ReadingPosition) {
    if (this.saves.has(sessionId)) {
      throw new Error(ErrorCode.LOCAL_REVISION_CONFLICT);
    }

    this.saves.add(sessionId);

    try {
      if (!this.bookmarks.has(sessionId)) {
        await this.getReadingPosition(sessionId);
      }

      const bookmark = this.bookmarks.get(sessionId)!;
      const revision = bookmark.revision;

      if (bookmark.position && position.updatedAt <= bookmark.position.updatedAt) {
        return { position: bookmark.position };
      }

      try {
        const response = bookmarkSchema.parse(
          await this.connection.request({
            operation: LocalOperation.ReadingSave,
            sessionId,
            position,
            revision,
          }),
        );

        this.bookmarks.set(sessionId, response);

        return { position: response.position };
      } catch (error) {
        if (error instanceof Error && error.message === ErrorCode.LOCAL_REVISION_CONFLICT) {
          return this.getReadingPosition(sessionId);
        }

        throw error;
      }
    } finally {
      this.saves.delete(sessionId);
    }
  }
}
