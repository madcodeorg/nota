const {
  createBrokerRefreshToken,
  openSealed,
  readJson,
  refreshGoogleAccessToken,
  sendError,
  sendJson,
  setCors,
} = require('../../server/google-oauth-broker/shared.cjs');

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  try {
    const body = await readJson(req);
    const payload = openSealed(body.refreshToken);

    if (payload.kind !== 'refresh' || !payload.refreshToken) {
      throw new Error('Invalid broker refresh token');
    }

    const tokenData = await refreshGoogleAccessToken(payload.refreshToken);
    sendJson(res, 200, {
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      refreshToken: createBrokerRefreshToken(
        tokenData.refresh_token || payload.refreshToken
      ),
    });
  } catch (err) {
    sendError(res, 400, err);
  }
};
