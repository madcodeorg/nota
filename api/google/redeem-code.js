const {
  createBrokerRefreshToken,
  openSealed,
  readJson,
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
    const payload = openSealed(body.code);

    if (payload.kind !== 'redeem') {
      throw new Error('Invalid broker code');
    }

    sendJson(res, 200, {
      accessToken: payload.accessToken,
      expiresIn: payload.expiresIn,
      refreshToken: createBrokerRefreshToken(payload.refreshToken),
      scopes: Array.isArray(payload.scopes) ? payload.scopes : undefined,
      userInfo: payload.userInfo,
    });
  } catch (err) {
    sendError(res, 400, err);
  }
};
