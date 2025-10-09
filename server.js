const { createRealtimeServer } = require('./src/server/realtimeServer');
const { REALTIME_WS_PATH, REALTIME_CLIENT_SECRETS_PATH } = require('./src/config/constants');

if (require.main === module) {
  const { start } = createRealtimeServer();
  start();
}

module.exports = {
  createRealtimeServer,
  REALTIME_WS_PATH,
  REALTIME_CLIENT_SECRETS_PATH,
};
