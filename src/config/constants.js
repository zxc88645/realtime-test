const path = require('path');

const { loadEnvironment } = require('./loadEnvironment');

loadEnvironment();

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const DEFAULT_API_KEY = process.env.OPENAI_API_KEY || null;
const DEFAULT_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const DEFAULT_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'verse';
const OPENAI_REALTIME_BASE_URL = 'https://api.openai.com/v1/realtime';

const REALTIME_PATH = '/openai/agents/realtime';
const REALTIME_WS_PATH = `${REALTIME_PATH}/ws`;
const REALTIME_CLIENT_SECRETS_PATH = '/v1/realtime/client_secrets';

const DEFAULT_PUBLIC_DIRECTORY = path.join(__dirname, '..', '..', 'public');

module.exports = {
  DEFAULT_PORT,
  DEFAULT_API_KEY,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
  OPENAI_REALTIME_BASE_URL,
  REALTIME_PATH,
  REALTIME_WS_PATH,
  REALTIME_CLIENT_SECRETS_PATH,
  DEFAULT_PUBLIC_DIRECTORY,
};
