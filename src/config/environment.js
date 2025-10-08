const {
  DEFAULT_PORT,
  DEFAULT_API_KEY,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
  OPENAI_REALTIME_BASE_URL,
  DEFAULT_PUBLIC_DIRECTORY,
} = require('./constants');
const { OpenAI } = require('@openai/agents');

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
  try {
    const baseUrl = new URL('./', `${realtimeBaseUrl.replace(/\/$/, '')}/`);
    return baseUrl.toString().replace(/\/$/, '');
  } catch (_error) {
    return undefined;
  }
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
    (() =>
      new OpenAI({
        apiKey,
        baseURL: resolveOpenAIBaseUrl(realtimeBaseUrl),
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
