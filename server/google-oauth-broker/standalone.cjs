const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const startHandler = require('../../api/google/start.js');
const callbackHandler = require('../../api/google/callback.js');
const calendarCalendarsHandler = require('../../api/google/calendar/calendars.js');
const calendarEventsHandler = require('../../api/google/calendar/events.js');
const redeemCodeHandler = require('../../api/google/redeem-code.js');
const refreshHandler = require('../../api/google/refresh.js');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const DOWNLOAD_URL = 'https://github.com/madcodeorg/nota/releases';

const routes = new Map([
  ['/api/google/start', startHandler],
  ['/api/google/callback', callbackHandler],
  ['/api/google/calendar/calendars', calendarCalendarsHandler],
  ['/api/google/calendar/events', calendarEventsHandler],
  ['/api/google/redeem-code', redeemCodeHandler],
  ['/api/google/refresh', refreshHandler],
]);

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function getPathname(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  return new URL(req.url || '/', `http://${host}`).pathname;
}

function getStaticPath(pathname) {
  const normalizedPathname = pathname === '/' ? '/launch.html' : pathname;
  const decodedPath = decodeURIComponent(normalizedPathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);

  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    return null;
  }

  return filePath;
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }

  const filePath = getStaticPath(getPathname(req));
  if (!filePath) {
    send(res, 403, 'Forbidden');
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  const contentType =
    mimeTypes.get(path.extname(filePath)) || 'application/octet-stream';
  res.writeHead(200, {
    'Cache-Control': 'public, max-age=300',
    'Content-Type': contentType,
  });

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  fs.createReadStream(filePath).pipe(res);
  return true;
}

function redirectToDownload(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (pathname !== '/download') return false;

  res.writeHead(302, {
    'Cache-Control': 'no-store',
    Location: DOWNLOAD_URL,
  });
  res.end();
  return true;
}

const server = http.createServer((req, res) => {
  const pathname = getPathname(req);

  if (pathname === '/healthz') {
    send(res, 200, JSON.stringify({ ok: true }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
    return;
  }

  const handler = routes.get(pathname);
  if (handler) {
    void Promise.resolve(handler(req, res)).catch(error => {
      console.error('[google-oauth-broker] Unhandled route error:', error);
      if (!res.headersSent) {
        send(res, 500, JSON.stringify({ error: 'Internal server error' }), {
          'Content-Type': 'application/json; charset=utf-8',
        });
      } else {
        res.end();
      }
    });
    return;
  }

  if (redirectToDownload(req, res, pathname)) return;

  if (serveStatic(req, res)) return;

  send(res, 404, 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[google-oauth-broker] listening on 0.0.0.0:${PORT}`);
});
