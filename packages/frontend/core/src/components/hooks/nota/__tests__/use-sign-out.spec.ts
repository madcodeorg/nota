/* eslint-disable rxjs/finnish */
/**
 * @vitest-environment happy-dom
 */
import { ServerFeature } from '@nota/graphql';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// mocks
const signOutFn = vi.fn();
const jumpToIndex = vi.fn();
const jumpToSignIn = vi.fn();
let allowGuestDemo: boolean | undefined = true;

vi.mock('@nota/core/modules/cloud', () => ({
  AuthService: class {},
  DefaultServerService: class {},
}));

vi.mock('@nota/infra', () => {
  return {
    useService: () => ({ signOut: signOutFn }),
    useServices: () => ({
      defaultServerService: {
        server: {
          config$: {
            value: {
              get features() {
                return allowGuestDemo !== false
                  ? [ServerFeature.LocalWorkspace]
                  : [];
              },
            },
          },
        },
      },
    }),
  };
});

vi.mock('@nota/component', () => {
  return {
    useConfirmModal: () => ({
      openConfirmModal: ({ onConfirm }: { onConfirm?: () => unknown }) => {
        return Promise.resolve(onConfirm?.());
      },
    }),
    notify: { error: vi.fn() },
  };
});

vi.mock('@nota/i18n', () => ({
  useI18n: () => new Proxy({}, { get: () => () => '' }),
}));

vi.mock('../../use-navigate-helper', () => ({
  useNavigateHelper: () => ({ jumpToIndex, jumpToSignIn }),
}));

import { useSignOut } from '../use-sign-out';

describe('useSignOut', () => {
  beforeEach(() => {
    signOutFn.mockClear();
    jumpToIndex.mockClear();
    jumpToSignIn.mockClear();
  });

  test('redirects to index when guest demo allowed', async () => {
    allowGuestDemo = true;
    const { result } = renderHook(() => useSignOut());
    result.current();
    await waitFor(() => expect(signOutFn).toHaveBeenCalled());
    expect(jumpToIndex).toHaveBeenCalled();
    expect(jumpToSignIn).not.toHaveBeenCalled();
  });

  test('redirects to index when guest demo config not provided', async () => {
    allowGuestDemo = undefined;
    const { result } = renderHook(() => useSignOut());
    result.current();
    await waitFor(() => expect(signOutFn).toHaveBeenCalled());
    expect(jumpToIndex).toHaveBeenCalled();
    expect(jumpToSignIn).not.toHaveBeenCalled();
  });

  test('redirects to sign in when guest demo disabled', async () => {
    allowGuestDemo = false;
    const { result } = renderHook(() => useSignOut());
    result.current();
    await waitFor(() => expect(signOutFn).toHaveBeenCalled());
    expect(jumpToSignIn).toHaveBeenCalled();
    expect(jumpToIndex).not.toHaveBeenCalled();
  });
});
