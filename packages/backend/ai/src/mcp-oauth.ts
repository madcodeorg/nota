import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

import {
  auth,
  type OAuthAuthorizationServerInformation,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from '@ai-sdk/mcp';

export type McpOAuthSettings = {
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
};

export type StoredMcpAuth = {
  authorizationServerInformation?: OAuthAuthorizationServerInformation;
  clientInformation?: OAuthClientInformation;
  redirectUrl?: string;
  tokens?: OAuthTokens;
};

type SignInOptions = {
  onRedirect(url: URL): void;
  redirectUrl: string;
  state: string;
};

const FALLBACK_REDIRECT_URL = 'http://127.0.0.1/callback';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

function authDirectory(settingsPath: string) {
  return path.join(path.dirname(path.resolve(settingsPath)), 'mcp-auth');
}

export function mcpAuthFilePath(settingsPath: string, name: string) {
  return path.join(
    authDirectory(settingsPath),
    `${encodeURIComponent(name)}.json`
  );
}

function ensureAuthDirectory(settingsPath: string) {
  const directory = authDirectory(settingsPath);
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('MCP credential directory is unsafe.');
  }
  chmodSync(directory, 0o700);
  return directory;
}

export function readMcpAuth(settingsPath: string, name: string): StoredMcpAuth {
  const filename = mcpAuthFilePath(settingsPath, name);
  if (!existsSync(filename)) {
    return {};
  }
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('MCP credential file is unsafe.');
  }
  try {
    const parsed = JSON.parse(readFileSync(filename, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as StoredMcpAuth)
      : {};
  } catch {
    return {};
  }
}

export function writeMcpAuth(
  settingsPath: string,
  name: string,
  data: StoredMcpAuth
) {
  const directory = ensureAuthDirectory(settingsPath);
  const filename = mcpAuthFilePath(settingsPath, name);
  const temporary = path.join(
    directory,
    `.${randomBytes(8).toString('hex')}.tmp`
  );
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(data));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(temporary, filename);
    chmodSync(filename, 0o600);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function updateMcpAuth(
  settingsPath: string,
  name: string,
  update: (current: StoredMcpAuth) => StoredMcpAuth
) {
  writeMcpAuth(settingsPath, name, update(readMcpAuth(settingsPath, name)));
}

export function hasMcpOAuthTokens(settingsPath: string, name: string) {
  try {
    return !!readMcpAuth(settingsPath, name).tokens?.access_token;
  } catch {
    return false;
  }
}

export function deleteMcpAuth(settingsPath: string, name: string) {
  cancelMcpOAuthSignIn(settingsPath, name);
  rmSync(mcpAuthFilePath(settingsPath, name), { force: true });
}

export function renameMcpAuth(settingsPath: string, from: string, to: string) {
  cancelMcpOAuthSignIn(settingsPath, from);
  const source = mcpAuthFilePath(settingsPath, from);
  if (existsSync(source)) {
    renameSync(source, mcpAuthFilePath(settingsPath, to));
  }
}

/**
 * Background providers (pool connections) only read and refresh stored
 * credentials. A sign-in provider keeps the new client registration and PKCE
 * state in memory and persists them together with the tokens on success, so
 * an abandoned sign-in never replaces working credentials.
 */
export function createMcpOAuthProvider(options: {
  auth: McpOAuthSettings;
  name: string;
  settingsPath: string;
  signIn?: SignInOptions;
}): OAuthClientProvider {
  const { auth: settings, name, settingsPath, signIn } = options;
  const pending: StoredMcpAuth & { codeVerifier?: string } = {};
  const stored = () => readMcpAuth(settingsPath, name);
  const redirectUrl = () =>
    signIn?.redirectUrl ?? stored().redirectUrl ?? FALLBACK_REDIRECT_URL;
  const tokenEndpointAuthMethod =
    settings.clientId && settings.clientSecret ? 'client_secret_post' : 'none';

  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return redirectUrl();
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: 'Nota',
        grant_types: ['authorization_code', 'refresh_token'],
        redirect_uris: [redirectUrl()],
        response_types: ['code'],
        token_endpoint_auth_method: tokenEndpointAuthMethod,
        ...(settings.scopes ? { scope: settings.scopes } : {}),
      };
    },
    clientInformation() {
      if (settings.clientId) {
        return {
          client_id: settings.clientId,
          ...(settings.clientSecret
            ? { client_secret: settings.clientSecret }
            : {}),
        };
      }
      if (pending.clientInformation) {
        return pending.clientInformation;
      }
      const saved = stored();
      // Dynamic registrations bind the loopback redirect, whose port changes
      // for every sign-in, so a different redirect needs a new registration.
      if (signIn && saved.redirectUrl !== signIn.redirectUrl) {
        return undefined;
      }
      return saved.clientInformation;
    },
    isClientInformationDynamicallyRegistered() {
      return !settings.clientId;
    },
    tokens() {
      return signIn ? pending.tokens : stored().tokens;
    },
    saveTokens(tokens) {
      if (!signIn) {
        updateMcpAuth(settingsPath, name, current => ({ ...current, tokens }));
        return;
      }
      pending.tokens = tokens;
      writeMcpAuth(settingsPath, name, {
        authorizationServerInformation:
          pending.authorizationServerInformation ??
          stored().authorizationServerInformation,
        clientInformation: settings.clientId
          ? undefined
          : (pending.clientInformation ?? stored().clientInformation),
        redirectUrl: signIn.redirectUrl,
        tokens,
      });
    },
    redirectToAuthorization(url) {
      signIn?.onRedirect(url);
    },
    saveCodeVerifier(codeVerifier) {
      pending.codeVerifier = codeVerifier;
    },
    codeVerifier() {
      if (!pending.codeVerifier) {
        throw new Error('No MCP sign-in is pending.');
      }
      return pending.codeVerifier;
    },
    state() {
      return signIn?.state ?? randomBytes(32).toString('base64url');
    },
    saveState() {},
    storedState() {
      return signIn?.state;
    },
    authorizationServerInformation() {
      return (
        pending.authorizationServerInformation ??
        stored().authorizationServerInformation
      );
    },
    saveAuthorizationServerInformation(information) {
      if (signIn) {
        pending.authorizationServerInformation = information;
      }
    },
    invalidateCredentials(scope) {
      if (scope === 'verifier') {
        delete pending.codeVerifier;
        return;
      }
      const dropTokens = scope === 'all' || scope === 'tokens';
      const dropClient = scope === 'all' || scope === 'client';
      if (signIn) {
        if (dropTokens) delete pending.tokens;
        if (dropClient) delete pending.clientInformation;
        return;
      }
      updateMcpAuth(settingsPath, name, current => ({
        ...current,
        ...(dropTokens ? { tokens: undefined } : {}),
        ...(dropClient ? { clientInformation: undefined } : {}),
      }));
    },
  };

  if (signIn) {
    provider.saveClientInformation = clientInformation => {
      pending.clientInformation = clientInformation;
    };
  }

  return provider;
}

const pendingSignIns = new Map<string, { cancel(): void }>();

function signInKey(settingsPath: string, name: string) {
  return `${path.resolve(settingsPath)}\0${name}`;
}

function equalState(provided: string | null, expected: string) {
  if (!provided) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

function previousCallbackPort(settingsPath: string, name: string) {
  try {
    const url = new URL(readMcpAuth(settingsPath, name).redirectUrl ?? '');
    return url.hostname === '127.0.0.1' ? Number(url.port) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Signs out but keeps the client registration for the next sign-in. */
export function clearMcpOAuthTokens(settingsPath: string, name: string) {
  cancelMcpOAuthSignIn(settingsPath, name);
  const { clientInformation, redirectUrl } = readMcpAuth(settingsPath, name);
  if (!clientInformation) {
    rmSync(mcpAuthFilePath(settingsPath, name), { force: true });
    return;
  }
  writeMcpAuth(settingsPath, name, { clientInformation, redirectUrl });
}

export function cancelMcpOAuthSignIn(settingsPath: string, name: string) {
  pendingSignIns.get(signInKey(settingsPath, name))?.cancel();
}

export async function startMcpOAuthSignIn(options: {
  auth: McpOAuthSettings;
  fetchFn?: typeof fetch;
  name: string;
  onComplete?: () => void;
  serverUrl: string;
  settingsPath: string;
  timeoutMs?: number;
}): Promise<{ url: string }> {
  const { fetchFn, name, serverUrl, settingsPath } = options;
  const key = signInKey(settingsPath, name);
  cancelMcpOAuthSignIn(settingsPath, name);

  const server = createServer();
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  // Reusing the last callback port lets the provider's existing client
  // registration (bound to that exact redirect URL) be used again.
  const previousPort = previousCallbackPort(settingsPath, name);
  try {
    await listen(previousPort);
  } catch (error) {
    if (!previousPort) throw error;
    await listen(0);
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to start the MCP sign-in callback.');
  }

  const redirectUrl = `http://127.0.0.1:${address.port}/callback`;
  const state = randomBytes(32).toString('base64url');
  let authorizationUrl: URL | undefined;
  const provider = createMcpOAuthProvider({
    auth: options.auth,
    name,
    settingsPath,
    signIn: {
      onRedirect: url => {
        authorizationUrl = url;
      },
      redirectUrl,
      state,
    },
  });

  let handling = false;
  const pending = {
    cancel() {
      clearTimeout(timeout);
      server.close();
      server.closeIdleConnections();
      if (pendingSignIns.get(key) === pending) pendingSignIns.delete(key);
    },
  };
  const timeout = setTimeout(
    () => pending.cancel(),
    options.timeoutMs ?? SIGN_IN_TIMEOUT_MS
  );
  timeout.unref();
  server.unref();
  pendingSignIns.get(key)?.cancel();
  pendingSignIns.set(key, pending);

  server.on('request', (request, response) => {
    const sendText = (status: number, body: string) => {
      response
        .writeHead(status, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        })
        .end(body);
    };
    const url = new URL(request.url ?? '/', redirectUrl);
    if (request.method !== 'GET' || url.pathname !== '/callback') {
      response.writeHead(404).end();
      return;
    }
    if (!equalState(url.searchParams.get('state'), state)) {
      sendText(400, 'Invalid sign-in state.');
      return;
    }
    if (handling || pendingSignIns.get(key) !== pending) {
      sendText(409, 'Sign-in is no longer pending.');
      return;
    }
    handling = true;
    const failure =
      'Sign-in could not be completed. Return to Nota and try again.';
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error') || !code) {
      sendText(400, failure);
      pending.cancel();
      return;
    }
    void auth(provider, {
      authorizationCode: code,
      callbackIssuer: url.searchParams.get('iss') ?? undefined,
      callbackState: state,
      fetchFn,
      serverUrl,
    })
      .then(result => {
        if (result !== 'AUTHORIZED') {
          throw new Error('MCP sign-in was not authorized.');
        }
        options.onComplete?.();
        sendText(200, 'Sign-in complete. Return to Nota.');
      })
      .catch(() => sendText(400, failure))
      .finally(() => pending.cancel());
  });

  try {
    const result = await auth(provider, {
      fetchFn,
      scope: options.auth.scopes,
      serverUrl,
    });
    if (
      result !== 'REDIRECT' ||
      !authorizationUrl ||
      (authorizationUrl.protocol !== 'https:' &&
        authorizationUrl.protocol !== 'http:')
    ) {
      throw new Error('The MCP server did not return a sign-in page.');
    }
  } catch (error) {
    pending.cancel();
    if (
      error instanceof Error &&
      /dynamic client registration/i.test(error.message)
    ) {
      throw new Error(
        'This server does not support automatic sign-in. Add a client ID under Advanced OAuth settings, or use an API key instead.'
      );
    }
    throw error;
  }
  if (pendingSignIns.get(key) !== pending) {
    throw new Error('MCP sign-in was cancelled.');
  }
  return { url: authorizationUrl.toString() };
}
