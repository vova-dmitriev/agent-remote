import type { Target } from '@protocol';

export interface Binding {
  target: Target;
  generation: string;
  localProof: string;
}
