const {
  DEFAULT_PORT,
  DEFAULT_API_KEY,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
  OPENAI_REALTIME_BASE_URL,
  DEFAULT_PUBLIC_DIRECTORY,
} = require('./constants');
const { createDefaultRealtimeClient } = require('../openai/createDefaultRealtimeClient');

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

  const normalizedFetch = ensureFetch(fetchImpl);

  const openAIClientFactory =
    createOpenAIClient ??
    (() =>
      createDefaultRealtimeClient({
        apiKey,
        fetchImpl: normalizedFetch,
        realtimeBaseUrl: OPENAI_REALTIME_BASE_URL,
      }));

  return {
    port,
    apiKey,
    realtimeModel,
    realtimeVoice,
    realtimeBaseUrl,
    fetchImpl: normalizedFetch,
    createOpenAIClient: ensureOpenAIClientFactory(openAIClientFactory),
    publicDirectory,
  };
}

module.exports = { buildConfig };
