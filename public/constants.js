export const REALTIME_MODEL = 'gpt-4o-realtime-preview-2024-12-17';
export const REALTIME_BASE_URL = 'https://api.openai.com/v1/realtime';
export const REALTIME_WS_PATH = '/openai/agents/realtime/ws';
export const REALTIME_EPHEMERAL_PATH = '/openai/agents/realtime/ephemeral-token';
export const REALTIME_VOICE = 'verse';
export const AUDIO_SAMPLE_RATE = 24000;

export const THEME_STORAGE_KEY = 'realtime-preferred-theme';


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
