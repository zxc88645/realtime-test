export const REALTIME_MODEL = 'gpt-4o-realtime-preview-2024-12-17';
export const REALTIME_BASE_URL = 'https://api.openai.com/v1/realtime';
export const REALTIME_WS_PATH = '/openai/agents/realtime/ws';
export const REALTIME_EPHEMERAL_PATH = '/openai/agents/realtime/ephemeral-token';
export const REALTIME_VOICE = 'verse';
export const AUDIO_SAMPLE_RATE = 24000;

export const THEME_STORAGE_KEY = 'realtime-preferred-theme';
export const LANGUAGE_STORAGE_KEY = 'realtime-preferred-language';

export const LANGUAGE_OPTIONS = [
  {
    id: 'zh-Hant',
    label: '繁體中文',
    description: '以自然的繁體中文互動。',
    prompt: '請全程使用繁體中文回覆，語氣親切且專業。',
  },
  {
    id: 'en',
    label: '英文',
    description: '切換成英文對話與解說。',
    prompt: '請改用英文回覆，保持語氣清楚且專業。',
  },
  {
    id: 'ja',
    label: '日文',
    description: '以日文提供說明與建議。',
    prompt: '請改用自然的日文回覆，並適度解釋專有名詞。',
  },
  {
    id: 'ko',
    label: '韓文',
    description: '以韓文交流並維持禮貌語氣。',
    prompt: '請改用韓文回覆，語氣禮貌且清楚。',
  },
  {
    id: 'es',
    label: '西班牙文',
    description: '練習西班牙文的最佳夥伴。',
    prompt: '請改用西班牙文回覆，並在需要時提供簡短的解釋。',
  },
];

export const ROLE_LABELS = {
  user: '你',
  'gpt-ws': 'GPT（WebSocket）',
  'gpt-webrtc': 'GPT（WebRTC）',
  error: '錯誤',
};

export const MODE_LABELS = {
  ws: 'WebSocket',
  webrtc: 'WebRTC 資料通道',
};

export const MODE_OPTIONS = [
  {
    id: 'ws',
    label: MODE_LABELS.ws,
    description: '透過伺服器橋接至 OpenAI Realtime API，支援語音與文字即時互動。',
  },
  {
    id: 'webrtc',
    label: MODE_LABELS.webrtc,
    description: '使用瀏覽器直接與模型建立資料通道，可即時語音互動。',
  },
];

export const MESSAGE_BASE_CLASS =
  'message-bubble max-w-3xl rounded-3xl border px-5 py-4 text-sm leading-7 shadow-sm';
