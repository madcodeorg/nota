import path, { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, net, protocol, session } from 'electron';
import cookieParser from 'set-cookie-parser';

import { isWindows, resourcesPath } from '../shared/utils';
import {
  getAiBackendBaseUrl,
  getAiBackendStatus,
  withAiBackendAuth,
} from './ai-backend';
import { isDev } from './config';
import { anotherHost, mainHost } from './constants';
import { logger } from './logger';
import { fetchProtocolResponse } from './protocol-proxy';

const webStaticDir = join(resourcesPath, 'web-static');
const devServerBase = process.env.DEV_SERVER_URL;
const localWhiteListDirs = [
  path.resolve(app.getPath('sessionData')).toLowerCase(),
  path.resolve(app.getPath('temp')).toLowerCase(),
];

function isPathInWhiteList(filepath: string) {
  const lowerFilePath = filepath.toLowerCase();
  return localWhiteListDirs.some(whitelistDir =>
    lowerFilePath.startsWith(whitelistDir)
  );
}

// Nota is a local-first fork with no hosted cloud backend. Both dev and
// packaged builds talk to the local AI backend, which the desktop app spawns as
// a utility process (see main/ai-backend). `NOTA_AI_BACKEND_URL` can override it
// (e.g. to point at a separately-run dev server).
function resolveApiBaseUrl() {
  return getAiBackendBaseUrl();
}

function buildTargetUrl(base: string, urlObject: URL) {
  return new URL(`${urlObject.pathname}${urlObject.search}`, base).toString();
}

function proxyRequest(
  request: Request,
  urlObject: URL,
  base: string,
  options: {
    authenticateBackend?: boolean;
    bypassCustomProtocolHandlers?: boolean;
  } = {}
) {
  const { authenticateBackend = false, bypassCustomProtocolHandlers = true } =
    options;
  const targetUrl = buildTargetUrl(base, urlObject);
  const clonedRequest = authenticateBackend
    ? new Request(request, {
        headers: withAiBackendAuth(request.headers),
        // Let the renderer follow any redirect as a fresh request so the
        // loopback credential can never escape to a redirected origin.
        redirect: 'manual',
      })
    : request.clone();
  return fetchProtocolResponse(
    clonedRequest,
    targetUrl,
    (url, init) => net.fetch(url, init),
    bypassCustomProtocolHandlers
  );
}

async function handleFileRequest(request: Request) {
  const urlObject = new URL(request.url);

  if (urlObject.host === anotherHost) {
    urlObject.host = mainHost;
  }

  const isAbsolutePath = urlObject.host !== '.';
  const isApiRequest =
    !isAbsolutePath &&
    (urlObject.pathname.startsWith('/api/') ||
      urlObject.pathname.startsWith('/v1/') ||
      urlObject.pathname === '/graphql');

  if (isApiRequest) {
    const backendStatus = getAiBackendStatus();
    if (!backendStatus.available) {
      return Response.json(
        {
          error: backendStatus.error
            ? `Nota AI is unavailable: ${backendStatus.error}`
            : 'Nota AI is unavailable.',
        },
        { status: 503 }
      );
    }
    return proxyRequest(request, urlObject, resolveApiBaseUrl(), {
      authenticateBackend: true,
    });
  }

  const isFontRequest =
    urlObject.pathname &&
    /\.(woff2?|ttf|otf)$/i.test(urlObject.pathname.split('?')[0] ?? '');

  // Redirect to webpack dev server if available
  if (isDev && devServerBase && !isAbsolutePath && !isFontRequest) {
    return proxyRequest(request, urlObject, devServerBase, {
      bypassCustomProtocolHandlers: false,
    });
  }
  const clonedRequest = Object.assign(request.clone(), {
    bypassCustomProtocolHandlers: true,
  });
  // this will be file types (in the web-static folder)
  let filepath = '';

  // for relative path, load the file in resources
  if (!isAbsolutePath) {
    if (urlObject.pathname.split('/').at(-1)?.includes('.')) {
      // Sanitize pathname to prevent path traversal attacks
      const decodedPath = decodeURIComponent(urlObject.pathname);
      const normalizedPath = join(webStaticDir, decodedPath).normalize();
      if (!normalizedPath.startsWith(webStaticDir)) {
        // Attempted path traversal - reject by using empty path
        filepath = join(webStaticDir, '');
      } else {
        filepath = normalizedPath;
      }
    } else {
      // else, fallback to load the index.html instead
      filepath = join(webStaticDir, 'index.html');
    }
  } else {
    filepath = decodeURIComponent(urlObject.pathname);
    // on windows, the path could be start with '/'
    if (isWindows()) {
      filepath = path.resolve(filepath.replace(/^\//, ''));
    }
    // security check if the filepath is within app.getPath('sessionData')
    if (urlObject.host !== 'local-file' || !isPathInWhiteList(filepath)) {
      throw new Error('Invalid filepath');
    }
  }
  return net.fetch(pathToFileURL(filepath).toString(), clonedRequest);
}

const needRefererDomains = [
  /^(?:[a-zA-Z0-9-]+\.)*youtube\.com$/,
  /^(?:[a-zA-Z0-9-]+\.)*youtube-nocookie\.com$/,
  /^(?:[a-zA-Z0-9-]+\.)*googlevideo\.com$/,
];
const defaultReferer = 'https://client.nota.local/';
const notaDomains = [
  /^(?:[a-z0-9-]+\.)*usercontent\.nota\.pro$/i,
  /^(?:[a-z0-9-]+\.)*nota\.pro$/i,
  /^(?:[a-z0-9-]+\.)*nota\.fail$/i,
  /^(?:[a-z0-9-]+\.)*nota\.run$/i,
];

function setHeader(
  headers: Record<string, string[]>,
  name: string,
  value: string
) {
  Object.keys(headers).forEach(key => {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete headers[key];
    }
  });
  headers[name] = [value];
}

function ensureFrameAncestors(
  headers: Record<string, string[]>,
  directive: string
) {
  const cspHeaderKey = Object.keys(headers).find(
    key => key.toLowerCase() === 'content-security-policy'
  );
  if (!cspHeaderKey) {
    headers['Content-Security-Policy'] = [`frame-ancestors ${directive}`];
    return;
  }

  const values = headers[cspHeaderKey];
  headers[cspHeaderKey] = values.map(val => {
    if (typeof val !== 'string') return val as any;
    const directives = val
      .split(';')
      .map(v => v.trim())
      .filter(Boolean)
      .filter(d => !d.toLowerCase().startsWith('frame-ancestors'));
    directives.push(`frame-ancestors ${directive}`);
    return directives.join('; ');
  });
}

function allowCors(
  headers: Record<string, string[]>,
  origin: string = 'assets://.'
) {
  // Signed blob URLs redirect to *.usercontent.nota.pro without CORS headers.
  setHeader(headers, 'Access-Control-Allow-Origin', origin);
  setHeader(headers, 'Access-Control-Allow-Credentials', 'true');
  setHeader(headers, 'Access-Control-Allow-Methods', 'GET, HEAD, PUT, OPTIONS');
  setHeader(
    headers,
    'Access-Control-Allow-Headers',
    '*, Authorization, Content-Type, Range'
  );
}

function normalizeCookieSameSite(
  sameSite: string | undefined
): Electron.Cookie['sameSite'] {
  switch (sameSite?.toLowerCase()) {
    case 'none':
      return 'no_restriction';
    case 'lax':
      return 'lax';
    case 'strict':
      return 'strict';
    default:
      return 'unspecified';
  }
}

export function registerProtocol() {
  protocol.handle('assets', request => {
    return handleFileRequest(request);
  });

  session.defaultSession.webRequest.onHeadersReceived(
    (responseDetails, callback) => {
      const { responseHeaders, url } = responseDetails;
      (async () => {
        if (responseHeaders) {
          const originalCookie =
            responseHeaders['set-cookie'] || responseHeaders['Set-Cookie'];

          if (originalCookie) {
            // save the cookies, to support third party cookies
            for (const cookies of originalCookie) {
              const parsedCookies = cookieParser.parse(cookies);
              for (const parsedCookie of parsedCookies) {
                if (!parsedCookie.value) {
                  await session.defaultSession.cookies.remove(
                    responseDetails.url,
                    parsedCookie.name
                  );
                } else {
                  await session.defaultSession.cookies.set({
                    url: responseDetails.url,
                    domain: parsedCookie.domain,
                    expirationDate: parsedCookie.expires?.getTime(),
                    httpOnly: parsedCookie.httpOnly,
                    secure: parsedCookie.secure,
                    value: parsedCookie.value,
                    name: parsedCookie.name,
                    path: parsedCookie.path,
                    sameSite: normalizeCookieSameSite(parsedCookie.sameSite),
                  });
                }
              }
            }
          }

          const { protocol, hostname } = new URL(url);

          // Adjust CORS for assets responses and allow blob redirects on nota domains
          if (protocol === 'assets:') {
            delete responseHeaders['access-control-allow-origin'];
            delete responseHeaders['access-control-allow-headers'];
            delete responseHeaders['Access-Control-Allow-Origin'];
            delete responseHeaders['Access-Control-Allow-Headers'];
            setHeader(responseHeaders, 'X-Frame-Options', 'SAMEORIGIN');
            ensureFrameAncestors(responseHeaders, "'self'");
          } else if (
            (protocol === 'http:' || protocol === 'https:') &&
            notaDomains.some(regex => regex.test(hostname))
          ) {
            allowCors(responseHeaders);
          }
        }
      })()
        .catch(err => {
          logger.error('error handling headers received', err);
        })
        .finally(() => {
          callback({ responseHeaders });
        });
    }
  );

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = new URL(details.url);

    (async () => {
      // session cookies are set to assets:// on production
      // if sending request to the cloud, attach the session cookie (to nota cloud server)
      if (
        url.protocol === 'http:' ||
        url.protocol === 'https:' ||
        url.protocol === 'ws:' ||
        url.protocol === 'wss:'
      ) {
        const cookies = await session.defaultSession.cookies.get({
          url: details.url,
        });

        const cookieString = cookies
          .map(c => `${c.name}=${c.value}`)
          .join('; ');
        delete details.requestHeaders['cookie'];
        details.requestHeaders['Cookie'] = cookieString;
      }

      const hostname = url.hostname;
      const needReferer = needRefererDomains.some(regex =>
        regex.test(hostname)
      );
      if (needReferer && !details.requestHeaders['Referer']) {
        details.requestHeaders['Referer'] = defaultReferer;
      }
    })()
      .catch(err => {
        logger.error('error handling before send headers', err);
      })
      .finally(() => {
        callback({
          cancel: false,
          requestHeaders: details.requestHeaders,
        });
      });
  });
}
