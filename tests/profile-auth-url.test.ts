import { describe, expect, it } from 'vitest';
import { profileAuthUrlSchema } from '../packages/protocol/src/profile-auth-url.js';

describe('profile auth URL policy', () => {
  it('accepts only the bounded HTTPS OpenAI auth origin', () => {
    expect(profileAuthUrlSchema.safeParse('https://auth.openai.com/authorize?state=ok').success).toBe(true);

    for (const url of [
      'http://auth.openai.com/authorize',
      'https://auth.openai.com.evil.test/authorize',
      'https://user@auth.openai.com/authorize',
      'https://@auth.openai.com/authorize',
      'https://auth.openai.com:444/authorize',
      'https://auth.openai.com:443/authorize',
      'https://auth.openai.com:/authorize',
      'https://auth.openai.com:0443/authorize',
      'https:\\\\auth.openai.com\\authorize',
      'file:///etc/passwd',
      'https://127.0.0.1/authorize',
    ]) {
      expect(profileAuthUrlSchema.safeParse(url).success, url).toBe(false);
    }
  });
});
