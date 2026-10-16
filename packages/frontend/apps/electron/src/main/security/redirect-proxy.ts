import { isAllowedRedirectTarget } from '@nota/infra/utils';

import { isDev } from '../config';

const NOTA_HOSTNAME = 'thenota.app';

function resolveCurrentHostnameForRedirectAllowlist() {
  const devServerBase = process.env.DEV_SERVER_URL;
  if (!isDev || !devServerBase) return NOTA_HOSTNAME;

  try {
    return new URL(devServerBase).hostname;
  } catch {
    return NOTA_HOSTNAME;
  }
}

export function extractRedirectTarget(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const redirectUri = parsed.searchParams.get('redirect_uri');
    if (redirectUri) {
      return redirectUri;
    }

    if (parsed.hash) {
      const hash = parsed.hash.startsWith('#')
        ? parsed.hash.slice(1)
        : parsed.hash;

      const queryIndex = hash.indexOf('?');
      if (queryIndex !== -1) {
        const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
        const hashRedirect = hashParams.get('redirect_uri');
        if (hashRedirect) {
          return hashRedirect;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export type RedirectProxyValidationResult =
  | {
      allow: true;
      redirectTarget: string;
    }
  | {
      allow: false;
      reason: 'missing_redirect_target' | 'untrusted_redirect_target';
      redirectTarget?: string;
    };

export function validateRedirectProxyUrl(
  rawUrl: string
): RedirectProxyValidationResult {
  const redirectTarget = extractRedirectTarget(rawUrl);
  if (!redirectTarget) {
    return { allow: false, reason: 'missing_redirect_target' };
  }

  const currentHostname = resolveCurrentHostnameForRedirectAllowlist();
  if (!isAllowedRedirectTarget(redirectTarget, { currentHostname })) {
    return {
      allow: false,
      reason: 'untrusted_redirect_target',
      redirectTarget,
    };
  }

  return { allow: true, redirectTarget };
}
