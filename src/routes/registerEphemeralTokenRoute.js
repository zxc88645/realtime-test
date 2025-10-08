const { REALTIME_EPHEMERAL_PATH } = require('../config/constants');

function registerEphemeralTokenRoute(app, dependencies) {
  const { apiKey, realtimeModel, realtimeBaseUrl, fetchImpl } = dependencies;

  app.post(REALTIME_EPHEMERAL_PATH, async (_req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: '伺服器缺少 OPENAI_API_KEY' });
      return;
    }

    try {
      const response = await fetchImpl(`${realtimeBaseUrl}/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: realtimeModel,
          voice: 'verse',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('建立短效會話失敗', response.status, errorText);
        res
          .status(response.status)
          .json({ error: '建立短效會話失敗', details: errorText });
        return;
      }

      const data = await response.json();
      res.json({
        id: data.id,
        client_secret: data.client_secret,
        expires_at: data.client_secret?.expires_at ?? null,
      });
    } catch (error) {
      console.error('建立短效會話時發生錯誤', error);
      res.status(500).json({ error: '建立短效會話時發生錯誤' });
    }
  });
}

module.exports = { registerEphemeralTokenRoute };
