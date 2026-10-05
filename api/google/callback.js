const {
  createRedeemCode,
  exchangeGoogleCode,
  getRequestUrl,
  openSealed,
  redirect,
  redirectToAppError,
  sendError,
} = require('../../server/google-oauth-broker/shared.cjs');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  let redirectUri = null;

  try {
    const url = getRequestUrl(req);
    const error = url.searchParams.get('error');
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');

    if (!state) {
      throw new Error('Missing OAuth state');
    }

    const statePayload = openSealed(state);
    if (statePayload.kind !== 'state' || !statePayload.redirectUri) {
      throw new Error('Invalid OAuth state');
    }
    redirectUri = statePayload.redirectUri;

    if (error) {
      redirectToAppError(res, redirectUri, error);
      return;
    }

    if (!code) {
      throw new Error('Missing Google authorization code');
    }

    const tokenData = await exchangeGoogleCode(req, code);
    const brokerCode = createRedeemCode(tokenData);
    const appCallback = new URL(redirectUri);
    appCallback.searchParams.set('broker_code', brokerCode);
    redirect(res, appCallback.toString());
  } catch (err) {
    if (redirectUri) {
      redirectToAppError(res, redirectUri, err);
    } else {
      sendError(res, 400, err);
    }
  }
};
