import { describe, expect, test } from 'vitest';

import {
  isServerBackedWorkspaceFlavour,
  isUserOwnedWorkspaceFlavour,
} from './metadata';

describe('workspace flavour ownership', () => {
  test.each(['local', 'google-drive'])('%s is user-owned', flavour => {
    expect(isUserOwnedWorkspaceFlavour(flavour)).toBe(true);
    expect(isServerBackedWorkspaceFlavour(flavour)).toBe(false);
  });

  test.each(['nota-cloud', 'self-hosted-server'])(
    '%s is server-backed',
    flavour => {
      expect(isUserOwnedWorkspaceFlavour(flavour)).toBe(false);
      expect(isServerBackedWorkspaceFlavour(flavour)).toBe(true);
    }
  );
});
