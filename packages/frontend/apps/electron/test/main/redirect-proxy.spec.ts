import { describe, expect, it, vi } from 'vitest';

describe('redirect proxy allowlist', () => {
  it('blocks missing redirect_uri', async () => {
    vi.resetModules();
    process.env.BUILD_TYPE = 'stable';
    process.env.NODE_ENV = 'production';
    delete process.env.DEV_SERVER_URL;

    const { validateRedirectProxyUrl } =
      await import('../../src/main/security/redirect-proxy');
    expect(validateRedirectProxyUrl('assets://./redirect-proxy')).toEqual({
      allow: false,
      reason: 'missing_redirect_target',
    });
  });

  it('blocks untrusted redirect_uri', async () => {
    vi.resetModules();
    process.env.BUILD_TYPE = 'stable';
    process.env.NODE_ENV = 'production';
    delete process.env.DEV_SERVER_URL;

    const { validateRedirectProxyUrl } =
      await import('../../src/main/security/redirect-proxy');
    expect(
      validateRedirectProxyUrl(
        'assets://./redirect-proxy?redirect_uri=https%3A%2F%2Fevil.com%2F'
      )
    ).toEqual({
      allow: false,
      reason: 'untrusted_redirect_target',
      redirectTarget: 'https://evil.com/',
    });
  });

  it('allows trusted redirect_uri', async () => {
    vi.resetModules();
    process.env.BUILD_TYPE = 'stable';
    process.env.NODE_ENV = 'production';
    delete process.env.DEV_SERVER_URL;

    const { validateRedirectProxyUrl } =
      await import('../../src/main/security/redirect-proxy');
    expect(
      validateRedirectProxyUrl(
        'assets://./redirect-proxy?redirect_uri=https%3A%2F%2Fgithub.com%2Fheyyykk3%2Fnota'
      )
    ).toEqual({
      allow: true,
      redirectTarget: 'https://github.com/heyyykk3/nota',
    });
  });

  it('allows current hostname (canary)', async () => {
    vi.resetModules();
    process.env.BUILD_TYPE = 'canary';
    process.env.NODE_ENV = 'production';
    delete process.env.DEV_SERVER_URL;

    const { validateRedirectProxyUrl } =
      await import('../../src/main/security/redirect-proxy');
    expect(
      validateRedirectProxyUrl(
        'assets://./redirect-proxy?redirect_uri=https%3A%2F%2Fnota.fail%2Fpricing'
      )
    ).toEqual({
      allow: true,
      redirectTarget: 'https://nota.fail/pricing',
    });
  });

  it('allows current hostname from DEV_SERVER_URL in development', async () => {
    vi.resetModules();
    process.env.BUILD_TYPE = 'stable';
    process.env.NODE_ENV = 'development';
    process.env.DEV_SERVER_URL = 'http://localhost:8080';

    const { validateRedirectProxyUrl } =
      await import('../../src/main/security/redirect-proxy');
    expect(
      validateRedirectProxyUrl(
        'assets://./redirect-proxy?redirect_uri=http%3A%2F%2Flocalhost%3A1234%2Fauth'
      )
    ).toEqual({
      allow: true,
      redirectTarget: 'http://localhost:1234/auth',
    });
  });

  it('blocks redirect_uri in hash when untrusted', async () => {
    vi.resetModules();
    process.env.BUILD_TYPE = 'stable';
    process.env.NODE_ENV = 'production';
    delete process.env.DEV_SERVER_URL;

    const { validateRedirectProxyUrl } =
      await import('../../src/main/security/redirect-proxy');
    expect(
      validateRedirectProxyUrl(
        'assets://./redirect-proxy#/foo?redirect_uri=https%3A%2F%2Fevil.com%2F'
      )
    ).toEqual({
      allow: false,
      reason: 'untrusted_redirect_target',
      redirectTarget: 'https://evil.com/',
    });
  });
});
