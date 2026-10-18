import type { EnrollmentRecipient } from '../../../../../../packages/transport/src/credentials/types.js';
import type { ProfileJournal } from '../../lifecycle/journal.js';
import type { EnrollmentRepository } from '../repository.js';
import type { CredentialEnrollmentOptions } from '../types.js';

export interface EnrollmentContext {
  options: CredentialEnrollmentOptions;
  repository: EnrollmentRepository;
  journal: ProfileJournal;
  identity: () => Promise<EnrollmentRecipient>;
  active: Set<string>;
  now: () => number;
}
