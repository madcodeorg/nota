const crypto = require('node:crypto');

const GOOGLE_OAUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEFAULT_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/calendar.readonly',
];
const DEFAULT_ALLOWED_REDIRECT_ORIGINS = [
  'http://localhost:41013',
  'http://127.0.0.1:41013',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'https://thenota.app',
  'https://www.thenota.app',
  'https://app.nota.pro',
  'https://insider.nota.pro',
  'https://nota.pro',
];
const REDEEM_CODE_TTL_MS = 5 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64url(input) {
  return Buffer.from(input, 'base64url');
}

function getTokenSecret() {
  const secret = process.env.GOOGLE_OAUTH_TOKEN_SECRET;
  if (!secret) {
    throw new Error('GOOGLE_OAUTH_TOKEN_SECRET is missing');
  }

  return crypto.createHash('sha256').update(secret).digest();
}

function seal(payload, ttlMs) {
  const iv = crypto.randomBytes(12);
  const key = getTokenSecret();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = JSON.stringify({
    ...payload,
    exp: Date.now() + ttlMs,
  });
  const encrypted = Buffer.concat([
    cipher.update(body, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return ['v1', base64url(iv), base64url(encrypted), base64url(tag)].join('.');
}

function openSealed(token) {
  const [version, ivPart, encryptedPart, tagPart] = String(token).split('.');
  if (version !== 'v1' || !ivPart || !encryptedPart || !tagPart) {
    throw new Error('Invalid broker token');
  }

  const key = getTokenSecret();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    fromBase64url(ivPart)
  );
  decipher.setAuthTag(fromBase64url(tagPart));

  const decrypted = Buffer.concat([
    decipher.update(fromBase64url(encryptedPart)),
    decipher.final(),
  ]);
  const payload = JSON.parse(decrypted.toString('utf8'));

  if (!payload.exp || Date.now() > payload.exp) {
    throw new Error('Broker token expired');
  }

  return payload;
}

function getRequiredEnv(name, fallbackName) {
  const value =
    process.env[name] || (fallbackName ? process.env[fallbackName] : '');
  if (!value) {
    throw new Error(`${name} is missing`);
  }
  return value;
}

function getRequestUrl(req) {
  const host =
    req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  return new URL(req.url || '/', `${protocol}://${host}`);
}

function getGoogleRedirectUri(req) {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI) {
    return process.env.GOOGLE_OAUTH_REDIRECT_URI;
  }

  const url = getRequestUrl(req);
  return `${url.protocol}//${url.host}/api/google/callback`;
}

function getScopes() {
  const scopeConfig = process.env.GOOGLE_OAUTH_SCOPES;
  if (!scopeConfig) return DEFAULT_SCOPES;

  return scopeConfig
    .split(/[\s,]+/)
    .map(scope => scope.trim())
    .filter(Boolean);
}

function getAllowedRedirectOrigins() {
  const configured = process.env.NOTA_GOOGLE_ALLOWED_REDIRECT_ORIGINS;
  if (!configured) return DEFAULT_ALLOWED_REDIRECT_ORIGINS;

  return configured
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function validateRedirectUri(value) {
  if (!value) {
    throw new Error('redirect_uri is required');
  }

  const url = new URL(value);
  const allowedOrigins = getAllowedRedirectOrigins();
  if (!allowedOrigins.includes(url.origin)) {
    throw new Error(`redirect_uri origin is not allowed: ${url.origin}`);
  }

  if (url.pathname !== '/auth/callback') {
    throw new Error('redirect_uri path must be /auth/callback');
  }

  if (
    url.protocol === 'http:' &&
    url.hostname !== 'localhost' &&
    url.hostname !== '127.0.0.1'
  ) {
    throw new Error('http redirect_uri is only allowed for localhost');
  }

  if (url.hash) {
    throw new Error('redirect_uri must not include a hash');
  }

  return url.toString();
}

function buildGoogleAuthUrl(req, redirectUri) {
  const state = seal({ kind: 'state', redirectUri }, REDEEM_CODE_TTL_MS);
  const params = new URLSearchParams({
    access_type: 'offline',
    client_id: getRequiredEnv('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_CLIENT_ID'),
    include_granted_scopes: 'true',
    prompt: 'consent',
    redirect_uri: getGoogleRedirectUri(req),
    response_type: 'code',
    scope: getScopes().join(' '),
    state,
  });

  return `${GOOGLE_OAUTH_ENDPOINT}?${params.toString()}`;
}

function decodeJwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length < 2) {
    throw new Error('Invalid id_token');
  }

  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

function getUserInfo(idToken) {
  const payload = decodeJwtPayload(idToken);
  return {
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture,
    sub: payload.sub,
  };
}

async function exchangeGoogleCode(req, code) {
  const params = new URLSearchParams({
    client_id: getRequiredEnv('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_CLIENT_ID'),
    client_secret: getRequiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    code,
    grant_type: 'authorization_code',
    redirect_uri: getGoogleRedirectUri(req),
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
}

async function refreshGoogleAccessToken(refreshToken) {
  const params = new URLSearchParams({
    client_id: getRequiredEnv('GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_CLIENT_ID'),
    client_secret: getRequiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
}

function createRedeemCode(tokenData) {
  if (!tokenData.refresh_token) {
    throw new Error('Google did not return a refresh token');
  }
  if (!tokenData.id_token) {
    throw new Error('Google did not return an id_token');
  }

  return seal(
    {
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      kind: 'redeem',
      refreshToken: tokenData.refresh_token,
      scopes: tokenData.scope
        ? tokenData.scope
            .split(/\s+/)
            .map(scope => scope.trim())
            .filter(Boolean)
        : getScopes(),
      userInfo: getUserInfo(tokenData.id_token),
    },
    REDEEM_CODE_TTL_MS
  );
}

function createBrokerRefreshToken(refreshToken) {
  return seal({ kind: 'refresh', refreshToken }, REFRESH_TOKEN_TTL_MS);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function sendJson(res, statusCode, payload) {
  setCors(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, error) {
  sendJson(res, statusCode, {
    error: error instanceof Error ? error.message : String(error),
  });
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function redirectToAppError(res, redirectUri, error) {
  const url = new URL(redirectUri);
  url.searchParams.set(
    'error',
    error instanceof Error ? error.message : String(error)
  );
  redirect(res, url.toString());
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}');
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

module.exports = {
  buildGoogleAuthUrl,
  createBrokerRefreshToken,
  createRedeemCode,
  exchangeGoogleCode,
  getRequestUrl,
  openSealed,
  readJson,
  redirect,
  redirectToAppError,
  refreshGoogleAccessToken,
  sendError,
  sendJson,
  setCors,
  validateRedirectUri,
};
