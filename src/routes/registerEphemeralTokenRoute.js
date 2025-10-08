const { REALTIME_EPHEMERAL_PATH } = require('../config/constants');

function registerEphemeralTokenRoute(app, dependencies) {
  const { apiKey, realtimeModel, realtimeVoice, createOpenAIClient } = dependencies;

  app.post(REALTIME_EPHEMERAL_PATH, async (_req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: '伺服器缺少 OPENAI_API_KEY' });
      return;
    }

    let client;
    try {
      client = await Promise.resolve(createOpenAIClient());
    } catch (error) {
      console.error('建立 OpenAI 客戶端失敗', error);
      res.status(500).json({ error: '建立短效會話時發生錯誤' });
      return;
    }

    try {
      const session = await client.realtime.clientSecrets.create({
        model: realtimeModel,
        voice: realtimeVoice,
      });
      res.json({
        id: session.id,
        client_secret: session.client_secret,
        expires_at: session.client_secret?.expires_at ?? null,
      });
    } catch (error) {
      if (typeof error?.status === 'number') {
        const details =
          error?.error?.message ??
          (typeof error?.message === 'string' ? error.message : undefined) ??
          '建立短效會話失敗';
        console.error('建立短效會話失敗', error);
        res.status(error.status).json({ error: '建立短效會話失敗', details });
        return;
      }

      console.error('建立短效會話時發生錯誤', error);
      res.status(500).json({ error: '建立短效會話時發生錯誤' });
    }
  });
}

module.exports = { registerEphemeralTokenRoute };
