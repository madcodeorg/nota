const {
  buildGoogleAuthUrl,
  redirect,
  sendError,
  setCors,
  validateRedirectUri,
} = require('../../server/google-oauth-broker/shared.cjs');

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  try {
    const url = new URL(req.url || '/', 'https://thenota.app');
    const redirectUri = validateRedirectUri(
      url.searchParams.get('redirect_uri')
    );
    redirect(res, buildGoogleAuthUrl(req, redirectUri));
  } catch (err) {
    sendError(res, 400, err);
  }
};
