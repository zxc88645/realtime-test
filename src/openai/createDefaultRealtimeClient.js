const { OPENAI_REALTIME_BASE_URL } = require('../config/constants');

function ensureFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('環境缺少 fetch 實作');
  }
  return fetchImpl;
}

function createDefaultRealtimeClient(options) {
  const { apiKey, fetchImpl, realtimeBaseUrl = OPENAI_REALTIME_BASE_URL } = options;
  const fetch = ensureFetch(fetchImpl ?? global.fetch);

  return {
    realtime: {
      clientSecrets: {
        async create(sessionConfig) {
          const response = await fetch(`${realtimeBaseUrl}/client_secrets`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(sessionConfig),
          });

          if (!response.ok) {
            let errorBody;
            try {
              errorBody = await response.json();
            } catch (_error) {
              errorBody = { message: 'OpenAI 服務回應格式錯誤' };
            }

            const error = new Error('建立短效會話失敗');
            error.status = response.status;
            error.error = errorBody;
            throw error;
          }

          return await response.json();
        },
      },
    },
  };
}

module.exports = { createDefaultRealtimeClient };
