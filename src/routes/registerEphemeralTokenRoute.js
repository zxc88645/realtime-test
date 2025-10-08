const { REALTIME_EPHEMERAL_PATH } = require('../config/constants');
const {
  createRealtimeSessionService,
  RealtimeSessionError,
} = require('../services/createRealtimeSessionService');

function ensureSessionService(sessionService) {
  if (!sessionService || typeof sessionService.createSession !== 'function') {
    throw new Error('必須提供具備 createSession 方法的 sessionService');
  }
  return sessionService;
}

function registerEphemeralTokenRoute(app, dependencies) {
  const { apiKey } = dependencies;

  const sessionService = ensureSessionService(
    dependencies.sessionService ||
      createRealtimeSessionService({
        createOpenAIClient: dependencies.createOpenAIClient,
        realtimeModel: dependencies.realtimeModel,
        realtimeVoice: dependencies.realtimeVoice,
      })
  );

  app.post(REALTIME_EPHEMERAL_PATH, async (_req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: '伺服器缺少 OPENAI_API_KEY' });
      return;
    }

    try {
      const session = await sessionService.createSession();
      res.json(session);
    } catch (error) {
      if (error instanceof RealtimeSessionError && typeof error.status === 'number') {
        console.error('建立短效會話失敗', error);
        res.status(error.status).json({
          error: '建立短效會話失敗',
          details: error.details ?? '建立短效會話失敗',
        });
        return;
      }

      console.error('建立短效會話時發生錯誤', error);
      res.status(500).json({ error: '建立短效會話時發生錯誤' });
    }
  });
}

module.exports = { registerEphemeralTokenRoute };
