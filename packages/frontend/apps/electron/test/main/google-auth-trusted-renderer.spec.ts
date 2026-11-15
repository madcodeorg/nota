import { describe, expect, test } from 'vitest';

import {
  isTrustedGoogleSessionWorkbenchId,
  isTrustedOnboardingRenderer,
} from '../../src/main/google-auth/trusted-renderer';

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

describe('Google session from the first-launch window', () => {
  const url = 'assets://./onboarding';

  test('allows the onboarding window on the onboarding page', () => {
    expect(isTrustedOnboardingRenderer(7, url, 7, url)).toBe(true);
    expect(isTrustedOnboardingRenderer(7, `${url}?step=drive`, 7, url)).toBe(
      true
    );
  });

  test.each([
    ['another renderer', 8, url, 7],
    ['no onboarding window', 7, url, undefined],
    ['a navigated page', 7, 'https://example.com/onboarding', 7],
    ['a look-alike path', 7, `${url}-evil`, 7],
  ] as const)('denies %s', (_name, sender, senderUrl, onboardingId) => {
    expect(
      isTrustedOnboardingRenderer(sender, senderUrl, onboardingId, url)
    ).toBe(false);
  });
});
