export const CredentialEnrollmentDigest = { Sha256: 'SHA-256' } as const;

export const CredentialEnrollmentAlgorithm = { SealedBox: 'sodium_sealed_box' } as const;
export const CredentialEnrollmentLimits = {
  Version: 1,
  LifetimeMs: 5 * 60 * 1000,
  ClockSkewMs: 5000,
  ActiveChallenges: 64,
  SecretBytes: 16384,
  PlaintextBytes: 65536,
  CiphertextCharacters: 131072,
  PublicKeyBytes: 32,
  PublicKeyCharacters: 44,
} as const;
