const {
  listCalendars,
  readBearerToken,
} = require('../../../server/google-oauth-broker/calendar.cjs');
const {
  sendError,
  sendJson,
  setCors,
} = require('../../../server/google-oauth-broker/shared.cjs');

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
    const accessToken = readBearerToken(req);
    const calendars = await listCalendars(accessToken);
    sendJson(res, 200, { calendars });
  } catch (err) {
    sendError(res, err.status || 400, err);
  }
};
