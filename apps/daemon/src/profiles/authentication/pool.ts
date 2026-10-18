import { CodexProfileNative } from '../native/codex.js';
import { buildProfileEnvironment } from '../environment.js';
import { ProfileEnvironmentPurpose } from '../environment/values.js';
import { ProfileProcessCleanupError } from '../native/lifecycle/errors.js';
import { assertProfileCaller, authenticationProfile } from './state.js';
import type {
  ProfileAuthenticationOptions,
  ProfileAuthenticationEntry,
  ProfileAuthenticationNative,
} from './types.js';

export class ProfileAuthenticationPool {
  private pending = new Map<string, ProfileAuthenticationEntry>();

  constructor(private options: ProfileAuthenticationOptions) {}

  async open(id: string, version: number, current: () => boolean): Promise<ProfileAuthenticationNative> {
    assertProfileCaller(current);
    authenticationProfile(this.options, id, version);
    let pending = this.pending.get(id);

    if (pending && (pending.version !== version || pending.closing)) {
      await this.close(id, pending.version);

      return this.open(id, version, current);
    }

    if (!pending) {
      pending = { version, opening: this.create(id, version, current) };
      this.pending.set(id, pending);
    }

    try {
      const native = await pending.opening;

      assertProfileCaller(current);
      authenticationProfile(this.options, id, version);

      return native;
    } catch (error) {
      await this.close(id, version);
      throw error;
    }
  }

  private async create(id: string, version: number, current: () => boolean) {
    const profile = authenticationProfile(this.options, id, version);

    const environment = await buildProfileEnvironment(this.options.registry, id, {
      directory: this.options.directory,
      base: this.options.baseEnvironment,
      purpose: ProfileEnvironmentPurpose.Enrollment,
    });

    assertProfileCaller(current);
    authenticationProfile(this.options, id, version);

    return (this.options.open ?? CodexProfileNative.open)(environment, profile, this.options.native);
  }

  async close(id: string, version?: number): Promise<boolean> {
    const pending = this.pending.get(id);

    if (!pending || (version !== undefined && pending.version !== version)) {
      return false;
    }

    pending.closing ??= (async () => {
      const native = await pending.opening.catch((error: unknown) => {
        if (error instanceof ProfileProcessCleanupError) {
          throw error;
        }

        // A failed open returns only after its owned child has exited.
        return null;
      });

      await native?.close();

      if (this.pending.get(id) === pending) {
        this.pending.delete(id);
      }
    })();

    await pending.closing;

    return true;
  }

  async closeAll() {
    await Promise.all([...this.pending.keys()].map((id) => this.close(id)));
  }
}
