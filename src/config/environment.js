const {
  DEFAULT_PORT,
  DEFAULT_API_KEY,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
  OPENAI_REALTIME_BASE_URL,
  DEFAULT_PUBLIC_DIRECTORY,
} = require('./constants');


function ensureFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('環境缺少 fetch 實作');
  }
  return fetchImpl;
}

function ensureOpenAIClientFactory(createOpenAIClient) {
  if (typeof createOpenAIClient !== 'function') {
    throw new Error('環境缺少 OpenAI 客戶端工廠');
  }
  return createOpenAIClient;
}

function resolveOpenAIBaseUrl(realtimeBaseUrl) {
  // OpenAI 客戶端需要基礎 API URL，不包含 /realtime 路徑
  return 'https://api.openai.com/v1';
}

function buildConfig(options = {}) {
  const {
    port = DEFAULT_PORT,
    apiKey = DEFAULT_API_KEY,
    realtimeModel = DEFAULT_REALTIME_MODEL,
    realtimeVoice = DEFAULT_REALTIME_VOICE,
    realtimeBaseUrl = OPENAI_REALTIME_BASE_URL,
    fetchImpl = global.fetch,
    createOpenAIClient,
    publicDirectory = DEFAULT_PUBLIC_DIRECTORY,
  } = options;

  const openAIClientFactory =
    createOpenAIClient ??
    (() => ({
      createSession: async (config) => {
        const response = await fetchImpl('https://api.openai.com/v1/realtime/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        });
        if (!response.ok) {
          const error = await response.json();
          throw { status: response.status, error };
        }
        return await response.json();
      },
    }));

  return {
    port,
    apiKey,
    realtimeModel,
    realtimeVoice,
    realtimeBaseUrl,
    fetchImpl: ensureFetch(fetchImpl),
    createOpenAIClient: ensureOpenAIClientFactory(openAIClientFactory),
    publicDirectory,
  };
}

module.exports = { buildConfig };
