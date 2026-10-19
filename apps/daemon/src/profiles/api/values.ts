export const ProfileApiEndpoint = { OpenAIModels: 'https://api.openai.com/v1/models' } as const;
export const ProfileApiLimit = { BodyBytes: 2 * 1024 * 1024, Models: 2048, TimeoutMs: 15000 } as const;
export const ProfileApiRequest = {
  Redirect: 'error',
  Cache: 'no-store',
  Credentials: 'omit',
} as const;
