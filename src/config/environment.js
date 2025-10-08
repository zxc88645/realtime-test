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

function buildConfig(options = {}) {
  const {
    port = DEFAULT_PORT,
    apiKey = DEFAULT_API_KEY,
    realtimeModel = DEFAULT_REALTIME_MODEL,
    realtimeVoice = DEFAULT_REALTIME_VOICE,
    realtimeBaseUrl = OPENAI_REALTIME_BASE_URL,
    fetchImpl = global.fetch,
    publicDirectory = DEFAULT_PUBLIC_DIRECTORY,
  } = options;

  return {
    port,
    apiKey,
    realtimeModel,
    realtimeVoice,
    realtimeBaseUrl,
    fetchImpl: ensureFetch(fetchImpl),
    publicDirectory,
  };
}

module.exports = { buildConfig };
