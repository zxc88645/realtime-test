const http = require('http');
const { WebSocketServer } = require('ws');

const { buildConfig } = require('../config/environment');
const { REALTIME_WS_PATH } = require('../config/constants');
const { createExpressApp } = require('../http/createExpressApp');
const { registerEphemeralTokenRoute } = require('../routes/registerEphemeralTokenRoute');
const {
  createRealtimeWebSocketHandler,
} = require('../websocket/createRealtimeWebSocketHandler');
const { createUpgradeHandler } = require('./createUpgradeHandler');
const {
  createRealtimeSessionService,
} = require('../services/createRealtimeSessionService');

function createRealtimeServer(options = {}) {
  const config = buildConfig(options);

  const app = createExpressApp({ publicDirectory: config.publicDirectory });

  const sessionService = createRealtimeSessionService({
    createOpenAIClient: config.createOpenAIClient,
    realtimeModel: config.realtimeModel,
    realtimeVoice: config.realtimeVoice,
  });

  registerEphemeralTokenRoute(app, {
    apiKey: config.apiKey,
    sessionService,
  });

  const server = http.createServer(app);
  const webSocketServer = new WebSocketServer({ noServer: true });

  const handleConnection = createRealtimeWebSocketHandler({
    apiKey: config.apiKey,
    realtimeModel: config.realtimeModel,
    realtimeVoice: config.realtimeVoice,
    realtimeBaseUrl: config.realtimeBaseUrl,
  });

  webSocketServer.on('connection', handleConnection);

  const upgradeHandler = createUpgradeHandler({
    webSocketServer,
    realtimeWsPath: REALTIME_WS_PATH,
  });

  server.on('upgrade', upgradeHandler);

  const start = (listenPort = config.port) =>
    server.listen(listenPort, () => {
      console.log(`伺服器已在 http://localhost:${listenPort} 上啟動`);
    });

  return { app, server, webSocketServer, start };
}

module.exports = { createRealtimeServer };
