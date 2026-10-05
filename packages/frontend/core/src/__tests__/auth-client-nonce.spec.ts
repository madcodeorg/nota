import { AuthSession } from '@nota/core/modules/cloud/entities/session';
import { AuthService } from '@nota/core/modules/cloud/services/auth';
import { FetchService } from '@nota/core/modules/cloud/services/fetch';
import { AuthStore } from '@nota/core/modules/cloud/stores/auth';
import { GlobalDialogService } from '@nota/core/modules/dialogs/services/dialog';
import { UrlService } from '@nota/core/modules/url/services/url';
import { Framework } from '@nota/infra';
import { of } from 'rxjs';
import { describe, expect, test, vi } from 'vitest';

describe('AuthService oauthPreflight', () => {
  test('should always send client_nonce on web', async () => {
    let nonce: string | undefined;

    const fetch = vi.fn(async (_input: string, _init?: RequestInit) => {
      return {
        json: async () => ({ url: 'https://example.com' }),
      } as any;
    });

    const framework = new Framework();

    framework.entity(
      AuthSession,
      () =>
        ({
          account$: of(null),
          revalidate: vi.fn(),
        }) as any
    );
    framework.service(FetchService, { fetch } as any);
    framework.store(AuthStore, {
      getClientNonce: () => nonce,
      setClientNonce: (n: string) => {
        nonce = n;
      },
    } as any);
    framework.service(UrlService, { getClientScheme: () => null } as any);
    framework.service(GlobalDialogService, { open: vi.fn() } as any);

    framework.service(AuthService, [
      FetchService,
      AuthStore,
      UrlService,
      GlobalDialogService,
    ]);

    const auth = framework.provider().get(AuthService);
    await auth.oauthPreflight('Google' as any, 'web');

    expect(fetch).toHaveBeenCalledOnce();
    const [, init] = fetch.mock.calls[0] as [
      string,
      (RequestInit & { body?: string })?,
    ];
    const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
    expect(body.client_nonce).toBeTypeOf('string');
    expect((body.client_nonce as string).length).toBeGreaterThan(0);
  });
});
