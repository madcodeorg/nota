const {
  listEventsForCalendars,
  readBearerToken,
} = require('../../../server/google-oauth-broker/calendar.cjs');
const {
  readJson,
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

  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  try {
    const accessToken = readBearerToken(req);
    const body = await readJson(req);
    const events = await listEventsForCalendars(accessToken, body);
    sendJson(res, 200, { events });
  } catch (err) {
    sendError(res, err.status || 400, err);
  }
};
