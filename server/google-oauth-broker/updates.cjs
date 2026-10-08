// Static update feed in electron-updater "generic" layout:
//   /updates/<channel>/latest-mac.yml  (+ latest.yml, latest-linux.yml)
//   /updates/<channel>/<artifact>.zip|.dmg|.exe|.AppImage|.blockmap
// Files live in UPDATES_DIR. The yml carries sha512 for each artifact, which
// electron-updater verifies; Squirrel.Mac also enforces the code signature.
const fs = require('node:fs');
const path = require('node:path');

const CHANNEL_RE = /^[a-z0-9]+$/;
const FILE_RE =
  /^[A-Za-z0-9][A-Za-z0-9._ -]*\.(yml|zip|dmg|exe|AppImage|blockmap|deb)$/;

function getUpdatesDir() {
  return path.resolve(
    process.env.UPDATES_DIR || path.join(__dirname, 'updates')
  );
}

function resolveUpdateFile(pathname, rootDir = getUpdatesDir()) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const parts = decoded.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'updates') return null;
  const [, channel, file] = parts;
  if (!CHANNEL_RE.test(channel) || !FILE_RE.test(file)) return null;
  const filePath = path.resolve(rootDir, channel, file);
  if (!filePath.startsWith(rootDir + path.sep)) return null;
  return filePath;
}

function handleUpdates(req, res, pathname) {
  if (!pathname.startsWith('/updates/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return true;
  }
  const filePath = resolveUpdateFile(pathname);
  let stat;
  try {
    stat = filePath && fs.statSync(filePath);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    res.writeHead(404, { 'Cache-Control': 'no-store' });
    res.end('Not found');
    return true;
  }
  const isManifest = filePath.endsWith('.yml');
  res.writeHead(200, {
    'Cache-Control': isManifest ? 'no-store' : 'public, max-age=3600',
    'Content-Length': stat.size,
    'Content-Type': isManifest
      ? 'text/yaml; charset=utf-8'
      : 'application/octet-stream',
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    fs.createReadStream(filePath).pipe(res);
  }
  return true;
}

// Finds the newest dmg listed in the channel manifest so /download can point
// at the site-hosted installer. Returns a URL path or null.
function findLatestDownload(channel = 'stable', rootDir = getUpdatesDir()) {
  try {
    const yml = fs.readFileSync(
      path.join(rootDir, channel, 'latest-mac.yml'),
      'utf8'
    );
    const match = yml.match(/url:\s*([^\s]+\.dmg)\s*$/m);
    if (!match || !FILE_RE.test(match[1])) return null;
    return `/updates/${channel}/${encodeURIComponent(match[1])}`;
  } catch {
    return null;
  }
}

module.exports = { handleUpdates, resolveUpdateFile, findLatestDownload };
