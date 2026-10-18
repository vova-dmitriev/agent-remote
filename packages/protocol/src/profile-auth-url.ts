import { z } from 'zod';
import {
  ProfileAuthUrlHost,
  ProfileAuthUrlMaxLength,
  ProfileAuthUrlProtocol,
} from './values/profile-auth-url.js';

export function isProfileAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const authority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/iu)?.[1];

    return (
      url.protocol === ProfileAuthUrlProtocol &&
      url.hostname === ProfileAuthUrlHost &&
      !url.username &&
      !url.password &&
      !url.port &&
      authority === ProfileAuthUrlHost
    );
  } catch {
    return false;
  }
}

export const profileAuthUrlSchema = z.string().url().max(ProfileAuthUrlMaxLength).refine(isProfileAuthUrl);
