import { describe, expect, test } from 'vitest';

import { isTrustedGoogleSessionWorkbenchId } from '../../src/main/google-auth/trusted-renderer';

describe('Google session renderer trust boundary', () => {
  test('allows app workspace WebContentsViews', () => {
    expect(isTrustedGoogleSessionWorkbenchId('app-workspace123')).toBe(true);
  });

  test.each([
    undefined,
    'shell',
    'meeting',
    'notification',
    'helper',
    'hidden',
  ])('denies non-workspace renderer context %s', workbenchId => {
    expect(isTrustedGoogleSessionWorkbenchId(workbenchId)).toBe(false);
  });
});
