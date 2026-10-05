import { createIdentifier } from '@nota/infra';

export interface AIButtonProvider {
  presentAIButton: () => Promise<void>;
  dismissAIButton: () => Promise<void>;
}

export const AIButtonProvider =
  createIdentifier<AIButtonProvider>('AIButtonProvider');
