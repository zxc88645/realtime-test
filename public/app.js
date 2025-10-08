import {
  createApp,
  computed,
  reactive,
  ref,
  watch,
} from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';

const REALTIME_MODEL = 'gpt-4o-realtime-preview-2024-12-17';
const REALTIME_BASE_URL = 'https://api.openai.com/v1/realtime';
const REALTIME_WS_PATH = '/openai/agents/realtime/ws';
const REALTIME_EPHEMERAL_PATH = '/openai/agents/realtime/ephemeral-token';
const REALTIME_VOICE = 'verse';
const AUDIO_SAMPLE_RATE = 24000;

const THEME_STORAGE_KEY = 'realtime-preferred-theme';
const LANGUAGE_STORAGE_KEY = 'realtime-preferred-language';

const LANGUAGE_OPTIONS = [
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

const ROLE_LABELS = {
  user: '你',
  'gpt-ws': 'GPT（WebSocket）',
  'gpt-webrtc': 'GPT（WebRTC）',
  error: '錯誤',
};

const MODE_LABELS = {
  ws: 'WebSocket',
  webrtc: 'WebRTC 資料通道',
};

const MODE_OPTIONS = [
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

const MESSAGE_BASE_CLASS =
  'message-bubble max-w-3xl rounded-3xl border px-5 py-4 text-sm leading-7 shadow-sm';

function messageContainerClass(role) {
  if (role === 'user') {
    return 'flex flex-col items-end gap-2 text-right';
  }
  return 'flex flex-col items-start gap-2';
}

function messageBubbleClass(role) {
  if (role === 'user') {
    return `${MESSAGE_BASE_CLASS} message-bubble--user`;
  }
  if (role === 'error') {
    return `${MESSAGE_BASE_CLASS} message-bubble--error`;
  }
  return `${MESSAGE_BASE_CLASS} message-bubble--assistant`;
}

function createTransportContext(id) {
  return reactive({
    id,
    status: '待命',
    latest: '–',
    average: '–',
    samples: 0,
    messages: [],
    isReady: false,
    connection: null,
    dataChannel: null,
    send: undefined,
    latencies: [],
    pendingMessages: new Map(),
    responsesById: new Map(),
    manualStop: false,
    localStream: null,
    remoteStream: null,
    audioElement: null,
    audioPlayer: null,
    mediaRecorder: null,
    microphoneStream: null,
    audioEncoder: null,
    isRecording: false,
    startRecording: undefined,
    stopRecording: undefined,
    cancelRecording: undefined,
    configureSession: undefined,
  });
}

function roleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}

function resetLatencies(transport) {
  transport.latencies.length = 0;
  transport.latest = '–';
  transport.average = '–';
  transport.samples = 0;
}

function recordLatency(transport, duration) {
  transport.latencies.push(duration);
  const average =
    transport.latencies.reduce((sum, value) => sum + value, 0) /
    transport.latencies.length;
  transport.latest = `${duration.toFixed(2)} 毫秒`;
  transport.average = `${average.toFixed(2)} 毫秒`;
  transport.samples = transport.latencies.length;
}

function appendMessage(transport, role, text = '') {
  const message = {
    id: crypto.randomUUID(),
    role,
    text,
  };
  transport.messages.push(message);
  return message;
}

function textFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => textFromContent(item)).join('');
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (Array.isArray(content.output_text)) {
      return content.output_text.join('');
    }
    if (Array.isArray(content.content)) {
      return textFromContent(content.content);
    }
    if (content.delta) {
      return textFromContent(content.delta);
    }
  }
  return '';
}

function extractDeltaText(event) {
  if (!event) return '';
  if (event.delta) {
    if (typeof event.delta.text === 'string') {
      return event.delta.text;
    }
    if (Array.isArray(event.delta.output_text)) {
      return event.delta.output_text.join('');
    }
    if (Array.isArray(event.delta.content) || typeof event.delta.content === 'object') {
      return textFromContent(event.delta.content);
    }
  }
  if (event.item && event.item.content) {
    return textFromContent(event.item.content);
  }
  return '';
}

function extractCompletedText(event, fallback = '') {
  if (!event) return fallback;
  const { response } = event;
  if (response) {
    if (Array.isArray(response.output_text)) {
      return response.output_text.join('');
    }
    if (Array.isArray(response.output)) {
      return textFromContent(response.output);
    }
    if (Array.isArray(response.content)) {
      return textFromContent(response.content);
    }
  }
  return fallback;
}

function arrayBufferToBase64(buffer) {
  if (!buffer) {
    return '';
  }
  const bytes = new Uint8Array(buffer);
  if (!bytes.byteLength) {
    return '';
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function createPcm16Encoder({ sampleRate = AUDIO_SAMPLE_RATE } = {}) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('瀏覽器不支援音訊編碼功能');
  }

  let audioContext = null;

  const ensureContext = async () => {
    if (!audioContext) {
      audioContext = new AudioContextClass({ sampleRate });
    }
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch (error) {
        console.warn('恢復 AudioContext 失敗', error);
      }
    }
    return audioContext;
  };

  const resampleToTarget = async (buffer) => {
    if (!buffer) {
      return null;
    }
    if (buffer.numberOfChannels === 1 && buffer.sampleRate === sampleRate) {
      return buffer;
    }
    const duration = buffer.duration;
    if (!duration) {
      return buffer;
    }
    const frameCount = Math.ceil(duration * sampleRate);
    const offlineContext = new OfflineAudioContext(1, frameCount, sampleRate);
    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineContext.destination);
    source.start(0);
    try {
      return await offlineContext.startRendering();
    } catch (error) {
      console.warn('重新取樣音訊時發生錯誤', error);
      return buffer;
    }
  };

  return {
    async encode(blob) {
      if (!blob || !blob.size) {
        return null;
      }
      const context = await ensureContext();
      const arrayBuffer = await blob.arrayBuffer();
      let decoded;
      try {
        decoded = await context.decodeAudioData(arrayBuffer.slice(0));
      } catch (error) {
        console.warn('解碼音訊片段時發生錯誤', error);
        return null;
      }
      if (!decoded || !decoded.length) {
        return null;
      }
      const resampled = await resampleToTarget(decoded);
      if (!resampled || !resampled.length) {
        return null;
      }
      const channelData = resampled.getChannelData(0);
      if (!channelData || !channelData.length) {
        return null;
      }
      const pcmBuffer = new ArrayBuffer(channelData.length * 2);
      const view = new DataView(pcmBuffer);
      for (let i = 0; i < channelData.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      return arrayBufferToBase64(pcmBuffer);
    },
    async close() {
      if (audioContext) {
        try {
          await audioContext.close();
        } catch (error) {
          console.warn('關閉音訊編碼器時發生錯誤', error);
        }
        audioContext = null;
      }
    },
  };
}

function ensureResponseEntry(transport, event) {
  const response = event?.response;
  if (!response?.id) {
    return null;
  }
  let entry = transport.responsesById.get(response.id);
  if (!entry) {
    const clientMessageId = response.metadata?.client_message_id;
    const messageRole = transport.id === 'ws' ? 'gpt-ws' : 'gpt-webrtc';
    const message = appendMessage(transport, messageRole);
    entry = {
      clientMessageId,
      message,
    };
    transport.responsesById.set(response.id, entry);
  } else if (!entry.clientMessageId && response.metadata?.client_message_id) {
    entry.clientMessageId = response.metadata.client_message_id;
  }
  return entry;
}

function handleRealtimeEvent(transport, event) {
  if (!event || typeof event !== 'object') {
    return;
  }

  if (event.type === 'error') {
    const message = event.error?.message || event.message || '發生未知的即時錯誤';
    appendMessage(transport, 'error', message);
    transport.status = '錯誤';
    return;
  }

  if (event.type === 'session.created') {
    transport.status = '已連線（語音就緒）';
    return;
  }

  if (event.type === 'response.audio.delta') {
    const audioChunk = event.delta;
    if (audioChunk) {
      try {
        const player = ensureAudioPlayer(transport);
        player.append(audioChunk).catch((error) => {
          console.warn('播放即時音訊失敗', error);
        });
      } catch (error) {
        console.warn('播放即時音訊失敗', error);
      }
    }
    return;
  }

  if (event.type === 'response.text.delta') {
    const entry = ensureResponseEntry(transport, event);
    if (entry && event.delta) {
      entry.message.text = `${entry.message.text || ''}${event.delta}`;
    }
    return;
  }

  if (event.type === 'response.audio_transcript.delta') {
    const entry = ensureResponseEntry(transport, event);
    if (entry && event.delta) {
      entry.message.text = `${entry.message.text || ''}${event.delta}`;
    }
    return;
  }

  if (event.type === 'response.done') {
    const entry = ensureResponseEntry(transport, event);
    if (entry?.clientMessageId && transport.pendingMessages.has(entry.clientMessageId)) {
      const started = transport.pendingMessages.get(entry.clientMessageId).start;
      recordLatency(transport, performance.now() - started);
      transport.pendingMessages.delete(entry.clientMessageId);
    }
    if (event.response?.id) {
      transport.responsesById.delete(event.response.id);
    }
    if (transport.id === 'ws' && transport.connection) {
      transport.status = '已連線（語音就緒）';
    }
    return;
  }
}

async function parseEventData(data) {
  if (typeof data === 'string') {
    return JSON.parse(data);
  }
  if (data instanceof Blob) {
    return JSON.parse(await data.text());
  }
  const decoder = new TextDecoder();
  if (data instanceof ArrayBuffer) {
    return JSON.parse(decoder.decode(data));
  }
  if (ArrayBuffer.isView(data)) {
    return JSON.parse(decoder.decode(data));
  }
  throw new Error('不支援的事件資料型別');
}

function buildResponseCreateEvent(text, clientMessageId, options = {}) {
  const { includeAudio = false, language } = options;
  const input = [];

  if (language?.prompt) {
    input.push({
      type: 'message',
      role: 'system',
      content: [
        {
          type: 'input_text',
          text: language.prompt,
        },
      ],
    });
  }

  input.push({
    type: 'message',
    role: 'user',
    content: [
      {
        type: 'input_text',
        text,
      },
    ],
  });

  const response = {
    metadata: {
      client_message_id: clientMessageId,
    },    
    input,
  };



  return {
    type: 'response.create',
    response,
  };
}

function buildAudioResponseCreateEvent(clientMessageId, options = {}) {
  const { language } = options;
  const input = [];
  
  if (language?.prompt) {
    input.push({
      type: 'message',
      role: 'system',
      content: [{
        type: 'input_text',
        text: language.prompt,
      }],
    });
  }
  
  return {
    type: 'response.create',
    response: {
      metadata: {
        client_message_id: clientMessageId,
      },
      modalities: ['audio', 'text'],
      input,
    },
  };
}

function createAudioPlayer({ sampleRate = 24000 } = {}) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  let nextStartTime = 0;

  async function ensureAudioContext() {
    if (!AudioContextClass) {
      throw new Error('瀏覽器不支援即時音訊播放');
    }
    if (!audioContext) {
      audioContext = new AudioContextClass({ sampleRate });
    }
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch (error) {
        console.warn('恢復 AudioContext 失敗', error);
      }
    }
    return audioContext;
  }

  function decodeBase64ToFloat32(base64) {
    if (!base64) {
      return null;
    }
    try {
      const binary = atob(base64);
      const view = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        view[index] = binary.charCodeAt(index);
      }
      const int16Array = new Int16Array(view.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i += 1) {
        float32Array[i] = Math.max(-1, Math.min(1, int16Array[i] / 32768));
      }
      return float32Array;
    } catch (error) {
      console.warn('解碼音訊資料失敗', error);
      return null;
    }
  }

  async function append(base64) {
    const samples = decodeBase64ToFloat32(base64);
    if (!samples || !samples.length) {
      return;
    }

    let context;
    try {
      context = await ensureAudioContext();
    } catch (error) {
      console.warn('初始化音訊播放失敗', error);
      return;
    }

    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const minimumStart = context.currentTime + 0.05;
    const startTime = Math.max(nextStartTime, minimumStart);
    try {
      source.start(startTime);
    } catch (error) {
      console.warn('播放音訊片段失敗', error);
      source.disconnect();
      return;
    }
    nextStartTime = startTime + buffer.duration;
    source.addEventListener('ended', () => {
      try {
        source.disconnect();
      } catch (disconnectError) {
        console.warn('釋放音訊資源失敗', disconnectError);
      }
    });
  }

  async function reset() {
    nextStartTime = 0;
    if (audioContext) {
      try {
        await audioContext.close();
      } catch (error) {
        console.warn('關閉 AudioContext 失敗', error);
      }
      audioContext = null;
    }
  }

  return { append, reset };
}

function ensureAudioPlayer(transport) {
  if (!transport.audioPlayer) {
    transport.audioPlayer = createAudioPlayer();
  }
  return transport.audioPlayer;
}



function stopWebSocketTransport(transport) {
  if (!transport) {
    return;
  }
  const hadConnection = !!transport.connection;
  transport.manualStop = hadConnection;
  if (typeof transport.cancelRecording === 'function') {
    try {
      transport.cancelRecording({ silent: true });
    } catch (error) {
      console.warn('取消語音錄製時發生錯誤', error);
    }
  }
  if (hadConnection) {
    try {
      transport.connection.close();
    } catch (error) {
      console.warn('關閉 WebSocket 連線時發生錯誤', error);
    }
  }
  transport.connection = null;
  transport.send = undefined;
  transport.isReady = false;
  transport.pendingMessages.clear();
  transport.responsesById.clear();
  if (transport.audioPlayer) {
    transport.audioPlayer.reset().catch((error) => {
      console.warn('重設即時音訊播放器失敗', error);
    });
  }
  if (transport.microphoneStream) {
    try {
      transport.microphoneStream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      console.warn('停止麥克風串流時發生錯誤', error);
    }
  }
  transport.mediaRecorder = null;
  transport.microphoneStream = null;
  transport.isRecording = false;
  if (transport.audioEncoder?.close) {
    Promise.resolve(transport.audioEncoder.close()).catch((error) => {
      console.warn('關閉音訊編碼器時發生錯誤', error);
    });
  }
  transport.audioEncoder = null;
  transport.startRecording = undefined;
  transport.stopRecording = undefined;
  transport.cancelRecording = undefined;
  transport.configureSession = undefined;
  transport.status = '待命';
  if (!hadConnection) {
    transport.manualStop = false;
  }
}

function stopWebRTCTransport(transport) {
  if (!transport) {
    return;
  }
  const hadConnection = !!transport.connection || !!transport.dataChannel;
  transport.manualStop = hadConnection;
  if (transport.audioElement) {
    try {
      transport.audioElement.srcObject = null;
    } catch (error) {
      console.warn('清除音訊元素來源時發生錯誤', error);
    }
  }
  if (transport.remoteStream) {
    try {
      transport.remoteStream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      console.warn('停止遠端音訊軌時發生錯誤', error);
    }
  }
  if (transport.localStream) {
    try {
      transport.localStream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      console.warn('停止本地音訊軌時發生錯誤', error);
    }
  }
  if (transport.dataChannel) {
    try {
      transport.dataChannel.close();
    } catch (error) {
      console.warn('關閉資料通道時發生錯誤', error);
    }
  }
  if (transport.connection) {
    try {
      transport.connection.close();
    } catch (error) {
      console.warn('關閉 WebRTC 連線時發生錯誤', error);
    }
  }
  transport.connection = null;
  transport.dataChannel = null;
  transport.send = undefined;
  transport.isReady = false;
  transport.pendingMessages.clear();
  transport.responsesById.clear();
  transport.localStream = null;
  transport.remoteStream = null;
  transport.status = '待命';
  if (!hadConnection) {
    transport.manualStop = false;
  }
}

function setTransceiverDirection(transceiver, direction) {
  if (!transceiver) {
    return;
  }
  if (typeof transceiver.setDirection === 'function') {
    try {
      transceiver.setDirection(direction);
      return;
    } catch (error) {
      console.warn('設定傳輸方向時發生錯誤', error);
    }
  }
  try {
    transceiver.direction = direction;
  } catch (error) {
    console.warn('無法直接設定傳輸方向', error);
  }
}

function startWebSocketTransport(transport, resolveLanguage) {
  if (transport.connection) {
    try {
      transport.connection.close();
    } catch (error) {
      console.warn('關閉既有 WebSocket 連線時發生錯誤', error);
    }
  }
  if (typeof transport.cancelRecording === 'function') {
    try {
      transport.cancelRecording({ silent: true });
    } catch (error) {
      console.warn('取消既有語音錄製時發生錯誤', error);
    }
  }
  if (transport.audioEncoder?.close) {
    Promise.resolve(transport.audioEncoder.close()).catch((error) => {
      console.warn('關閉音訊編碼器時發生錯誤', error);
    });
  }
  transport.audioEncoder = null;
  transport.connection = null;
  transport.send = undefined;
  transport.isReady = false;
  transport.pendingMessages.clear();
  transport.responsesById.clear();
  transport.startRecording = undefined;
  transport.stopRecording = undefined;
  transport.cancelRecording = undefined;
  transport.configureSession = undefined;
  transport.mediaRecorder = null;
  transport.microphoneStream = null;
  transport.isRecording = false;
  if (transport.audioPlayer) {
    transport.audioPlayer.reset().catch((error) => {
      console.warn('重設即時音訊播放器失敗', error);
    });
  }
  resetLatencies(transport);
  transport.status = '連線中…';

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}${REALTIME_WS_PATH}`);
  transport.connection = socket;

  const queue = [];

  const sendEvent = (event) => {
    const payload = JSON.stringify(event);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
      return true;
    }
    if (socket.readyState === WebSocket.CONNECTING) {
      queue.push(payload);
      return true;
    }
    return false;
  };

  let encoder = null;
  let recorder = null;
  let microphoneStream = null;
  let encodingQueue = Promise.resolve();
  let shouldSubmitRecording = true;
  let silentCancel = false;
  let hasAudioData = false;
  let pendingStopResolver = null;
  let encodingFailed = false;

  const ensureEncoder = async () => {
    if (!encoder) {
      encoder = createPcm16Encoder({ sampleRate: AUDIO_SAMPLE_RATE });
      transport.audioEncoder = encoder;
    }
    return encoder;
  };

  const releaseEncoder = async () => {
    if (encoder?.close) {
      try {
        await encoder.close();
      } catch (error) {
        console.warn('關閉音訊編碼器時發生錯誤', error);
      }
    }
    encoder = null;
    transport.audioEncoder = null;
  };

  const stopTracks = (stream) => {
    if (!stream) {
      return;
    }
    try {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn('停止音訊軌時發生錯誤', error);
        }
      });
    } catch (error) {
      console.warn('釋放音訊串流時發生錯誤', error);
    }
  };

  const resetRecordingState = () => {
    stopTracks(microphoneStream);
    microphoneStream = null;
    transport.microphoneStream = null;
    recorder = null;
    transport.mediaRecorder = null;
    transport.isRecording = false;
    shouldSubmitRecording = true;
    silentCancel = false;
    hasAudioData = false;
    encodingFailed = false;
    pendingStopResolver = null;
    encodingQueue = Promise.resolve();
  };

  const finalizeRecording = async () => {
    transport.isRecording = false;
    await encodingQueue.catch(() => {});
    encodingQueue = Promise.resolve();

    if (!shouldSubmitRecording || !hasAudioData) {
      if (hasAudioData) {
        sendEvent({ type: 'input_audio_buffer.clear' });
      }
      if (!silentCancel) {
        if (encodingFailed) {
          transport.status = '已連線（語音就緒）';
        } else if (!shouldSubmitRecording) {
          transport.status = '已連線（語音就緒）';
        } else if (!hasAudioData) {
          appendMessage(transport, 'error', '本次語音訊息沒有偵測到聲音，已取消送出。');
          transport.status = '已連線（語音就緒）';
        }
      }
      resetRecordingState();
      return;
    }

    transport.status = '等待語音回覆…';
    sendEvent({ type: 'input_audio_buffer.commit' });
    const clientMessageId = crypto.randomUUID();
    const language = typeof resolveLanguage === 'function' ? resolveLanguage() : null;
    const responseEvent = buildAudioResponseCreateEvent(clientMessageId, { language });
    sendEvent(responseEvent);
    transport.pendingMessages.set(clientMessageId, {
      start: performance.now(),
    });
    appendMessage(transport, 'user', '（語音訊息）');
    resetRecordingState();
  };

  const configureSession = (language) => {
    const instructions = ['你是一位即時語音助理，會以語音與文字同步回覆使用者。'];
    if (language?.prompt) {
      instructions.push(language.prompt);
    }
    const sessionUpdate = {
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: instructions.join('\n'),
      },
    };
    if (!REALTIME_VOICE) {
      delete sessionUpdate.session.voice;
    }
    sendEvent(sessionUpdate);
  };

  const startRecording = async () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendMessage(transport, 'error', 'WebSocket 尚未連線，無法開始錄音。');
      return false;
    }
    if (transport.isRecording) {
      return true;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      appendMessage(transport, 'error', '瀏覽器不支援麥克風擷取功能。');
      return false;
    }

    transport.status = '等待麥克風權限…';
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: AUDIO_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      console.error('取得麥克風權限失敗', error);
      appendMessage(transport, 'error', '無法取得麥克風權限，請確認瀏覽器設定。');
      transport.status = '已連線（語音就緒）';
      return false;
    }

    transport.microphoneStream = microphoneStream;

    try {
      recorder = new MediaRecorder(microphoneStream, { mimeType: 'audio/webm' });
    } catch (error) {
      console.error('建立 MediaRecorder 失敗', error);
      appendMessage(transport, 'error', '瀏覽器不支援目前的錄音設定。');
      transport.status = '已連線（語音就緒）';
      stopTracks(microphoneStream);
      microphoneStream = null;
      transport.microphoneStream = null;
      return false;
    }

    encodingQueue = Promise.resolve();
    shouldSubmitRecording = true;
    silentCancel = false;
    hasAudioData = false;
    encodingFailed = false;
    transport.mediaRecorder = recorder;
    transport.isRecording = true;

    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data || !event.data.size) {
        return;
      }
      encodingQueue = encodingQueue
        .then(async () => {
          const encoderInstance = await ensureEncoder();
          const base64 = await encoderInstance.encode(event.data);
          if (base64) {
            hasAudioData = true;
            sendEvent({ type: 'input_audio_buffer.append', audio: base64 });
          }
        })
        .catch((error) => {
          console.error('處理音訊片段時發生錯誤', error);
          if (!encodingFailed && !silentCancel) {
            appendMessage(transport, 'error', '編碼音訊片段失敗，已取消此次語音訊息。');
          }
          encodingFailed = true;
          shouldSubmitRecording = false;
          if (recorder && recorder.state !== 'inactive') {
            try {
              recorder.stop();
            } catch (stopError) {
              console.warn('停止錄音時發生錯誤', stopError);
            }
          }
        });
    });

    recorder.addEventListener('error', (event) => {
      console.error('MediaRecorder 錄音失敗', event.error || event);
      if (!encodingFailed && !silentCancel) {
        appendMessage(transport, 'error', '錄音發生錯誤，已取消此次語音訊息。');
      }
      encodingFailed = true;
      shouldSubmitRecording = false;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (stopError) {
          console.warn('停止錄音時發生錯誤', stopError);
        }
      }
    });

    const handleRecorderStop = () => {
      const finalize = finalizeRecording().catch((error) => {
        console.error('處理語音錄製結果時發生錯誤', error);
      });
      const resolver = pendingStopResolver;
      pendingStopResolver = null;
      if (resolver) {
        finalize.finally(resolver);
      }
    };

    recorder.addEventListener('stop', handleRecorderStop, { once: true });

    try {
      recorder.start(250);
    } catch (error) {
      console.error('啟動語音錄製失敗', error);
      appendMessage(transport, 'error', '啟動語音錄製失敗，請稍後再試。');
      transport.status = '已連線（語音就緒）';
      resetRecordingState();
      return false;
    }

    transport.status = '錄音中…';
    return true;
  };

  const stopRecording = async ({ shouldSubmit = true, silent = false } = {}) => {
    shouldSubmitRecording = shouldSubmit;
    silentCancel = silent;
    if (!recorder) {
      if (!silent) {
        transport.status = '已連線（語音就緒）';
      }
      return Promise.resolve();
    }
    if (recorder.state !== 'inactive') {
      return new Promise((resolve) => {
        pendingStopResolver = resolve;
        try {
          recorder.stop();
        } catch (error) {
          console.warn('停止錄音時發生錯誤', error);
          pendingStopResolver = null;
          resolve();
        }
      });
    }
    await finalizeRecording();
    return Promise.resolve();
  };

  transport.startRecording = startRecording;
  transport.stopRecording = () => stopRecording({ shouldSubmit: true });
  transport.cancelRecording = (options = {}) =>
    stopRecording({ shouldSubmit: false, silent: options?.silent ?? false });
  transport.configureSession = configureSession;

  socket.addEventListener('open', () => {
    transport.isReady = true;
    transport.status = '已連線（語音就緒）';
    while (queue.length && socket.readyState === WebSocket.OPEN) {
      socket.send(queue.shift());
    }
    configureSession(typeof resolveLanguage === 'function' ? resolveLanguage() : null);
  });

  socket.addEventListener('message', async (event) => {
    try {
      const payload = await parseEventData(event.data);
      handleRealtimeEvent(transport, payload);
    } catch (error) {
      console.error('解析 WebSocket 負載時發生錯誤', error);
    }
  });

  socket.addEventListener('close', () => {
    transport.isReady = false;
    stopRecording({ shouldSubmit: false, silent: true }).catch(() => {});
    releaseEncoder();
    transport.connection = null;
    transport.send = undefined;
    transport.pendingMessages.clear();
    transport.responsesById.clear();
    if (transport.audioPlayer) {
      transport.audioPlayer.reset().catch((error) => {
        console.warn('重設即時音訊播放器失敗', error);
      });
    }
    transport.startRecording = undefined;
    transport.stopRecording = undefined;
    transport.cancelRecording = undefined;
    transport.configureSession = undefined;
    transport.mediaRecorder = null;
    transport.microphoneStream = null;
    transport.isRecording = false;
    transport.status = transport.manualStop ? '待命' : '已關閉';
    transport.manualStop = false;
  });

  socket.addEventListener('error', (error) => {
    console.error('WebSocket 傳輸發生錯誤', error);
    transport.status = '錯誤（詳見主控台）';
  });

  transport.send = (text) => {
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      return false;
    }
    const message = text.trim();
    if (!message) {
      return false;
    }
    const clientMessageId = crypto.randomUUID();
    const language = typeof resolveLanguage === 'function' ? resolveLanguage() : null;
    const event = buildResponseCreateEvent(message, clientMessageId, {
      includeAudio: true,
      language,
    });
    if (!sendEvent(event)) {
      return false;
    }
    transport.pendingMessages.set(clientMessageId, {
      start: performance.now(),
    });
    appendMessage(transport, 'user', message);
    transport.status = '等待語音回覆…';
    return true;
  };
}

async function startWebRTCTransport(transport, resolveLanguage) {
  if (transport.connection) {
    try {
      transport.connection.close();
    } catch (error) {
      console.warn('關閉既有 WebRTC 連線時發生錯誤', error);
    }
  }
  transport.connection = null;
  transport.dataChannel = null;
  transport.send = undefined;
  transport.isReady = false;
  transport.pendingMessages.clear();
  transport.responsesById.clear();
  resetLatencies(transport);
  transport.status = '取得金鑰中…';

  let token;
  try {
    const response = await fetch(REALTIME_EPHEMERAL_PATH, {
      method: 'POST',
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`取得短效金鑰失敗（${response.status}）：${errorText}`);
    }
    const data = await response.json();
    token = data?.client_secret?.value || data?.client_secret;
    if (!token) {
      throw new Error('短效金鑰回應缺少 client secret');
    }
  } catch (error) {
    console.error('取得短效金鑰失敗', error);
    appendMessage(transport, 'error', error.message || '取得短效金鑰失敗');
    transport.status = '錯誤（金鑰）';
    return;
  }

  const peerConnection = new RTCPeerConnection();
  transport.connection = peerConnection;

  const dataChannel = peerConnection.createDataChannel('oai-events');
  transport.dataChannel = dataChannel;

  transport.remoteStream = new MediaStream();
  if (!transport.audioElement) {
    const audioElement = document.createElement('audio');
    audioElement.autoplay = true;
    audioElement.playsInline = true;
    audioElement.controls = false;
    audioElement.hidden = true;
    document.body.appendChild(audioElement);
    transport.audioElement = audioElement;
  }
  if (transport.audioElement) {
    transport.audioElement.srcObject = transport.remoteStream;
  }

  const audioTransceiver = peerConnection.addTransceiver('audio', {
    direction: 'sendrecv',
  });

  let localStream = null;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    transport.localStream = localStream;
    const [track] = localStream.getAudioTracks();
    if (track) {
      await audioTransceiver.sender.replaceTrack(track);
      setTransceiverDirection(audioTransceiver, 'sendrecv');
    } else {
      setTransceiverDirection(audioTransceiver, 'recvonly');
    }
  } catch (error) {
    console.warn('取得麥克風音訊失敗，將以僅接收模式繼續', error);
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    transport.localStream = null;
    setTransceiverDirection(audioTransceiver, 'recvonly');
  }

  peerConnection.addEventListener('track', (event) => {
    if (!transport.remoteStream) {
      return;
    }
    transport.remoteStream.addTrack(event.track);
    if (transport.audioElement) {
      const playPromise = transport.audioElement.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    }
  });

  dataChannel.addEventListener('open', () => {
    transport.isReady = true;
    transport.status = '已連線';
  });

  dataChannel.addEventListener('message', async (event) => {
    try {
      const payload = await parseEventData(event.data);
      handleRealtimeEvent(transport, payload);
    } catch (error) {
      console.error('解析資料通道負載時發生錯誤', error);
    }
  });

  dataChannel.addEventListener('close', () => {
    transport.isReady = false;
    transport.dataChannel = null;
    transport.connection = null;
    transport.send = undefined;
    transport.pendingMessages.clear();
    transport.responsesById.clear();
    transport.status = transport.manualStop ? '待命' : '已關閉';
    transport.manualStop = false;
    try {
      peerConnection.close();
    } catch (error) {
      console.warn('關閉對等連線時發生錯誤', error);
    }
  });

  dataChannel.addEventListener('error', (error) => {
    console.error('資料通道發生錯誤', error);
    transport.status = '錯誤（詳見主控台）';
  });

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await new Promise((resolve) => {
      if (peerConnection.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const checkState = () => {
        if (peerConnection.iceGatheringState === 'complete') {
          peerConnection.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      peerConnection.addEventListener('icegatheringstatechange', checkState);
      setTimeout(() => {
        peerConnection.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, 2000);
    });

    const offerSdp = peerConnection.localDescription?.sdp;
    if (!offerSdp) {
      throw new Error('缺少本地 SDP offer');
    }

    transport.status = '協商中…';

    const answerResponse = await fetch(
      `${REALTIME_BASE_URL}?model=${encodeURIComponent(REALTIME_MODEL)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/sdp',
        },
        body: offerSdp,
      }
    );

    if (!answerResponse.ok) {
      const errorText = await answerResponse.text();
      throw new Error(`OpenAI WebRTC 協商失敗（${answerResponse.status}）：${errorText}`);
    }

    const answerSdp = await answerResponse.text();
    await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    transport.status = '等待資料通道…';
  } catch (error) {
    console.error('WebRTC 協商失敗', error);
    appendMessage(transport, 'error', error.message || 'WebRTC 協商失敗');
    transport.status = '錯誤（詳見主控台）';
    try {
      peerConnection.close();
    } catch (closeError) {
      console.warn('關閉失敗的對等連線時發生錯誤', closeError);
    }
    transport.connection = null;
    transport.dataChannel = null;
    transport.send = undefined;
    transport.pendingMessages.clear();
    transport.responsesById.clear();
    transport.manualStop = false;
    return;
  }

  transport.send = (text) => {
    const channel = transport.dataChannel;
    if (!channel || channel.readyState !== 'open') {
      return false;
    }
    const message = text.trim();
    if (!message) {
      return false;
    }
    const clientMessageId = crypto.randomUUID();
    const language = typeof resolveLanguage === 'function' ? resolveLanguage() : null;
    channel.send(
      JSON.stringify(
        buildResponseCreateEvent(message, clientMessageId, {
          includeAudio: true,
          language,
        })
      )
    );
    transport.pendingMessages.set(clientMessageId, {
      start: performance.now(),
    });
    appendMessage(transport, 'user', message);
    return true;
  };
}

const app = createApp({
  setup() {
    const message = ref('');
    const messageInputRef = ref(null);
    const hasAttemptedConnection = reactive({ ws: false, webrtc: false });
    const selectedMode = ref('ws');
    const languageOptions = LANGUAGE_OPTIONS;

    const languageMap = new Map(languageOptions.map((item) => [item.id, item]));
    const getStoredLanguage = () => {
      try {
        const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (stored && languageMap.has(stored)) {
          return stored;
        }
      } catch (error) {
        console.warn('讀取偏好語言時發生錯誤', error);
      }
      return languageOptions[0]?.id ?? 'zh-Hant';
    };
    const selectedLanguageId = ref(getStoredLanguage());
    const activeLanguage = computed(
      () => languageMap.get(selectedLanguageId.value) ?? languageOptions[0]
    );

    watch(
      selectedLanguageId,
      (value) => {
        try {
          localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
        } catch (error) {
          console.warn('儲存偏好語言時發生錯誤', error);
        }
        const language = languageMap.get(value) ?? languageOptions[0];
        if (
          ws.configureSession &&
          ws.connection &&
          ws.connection.readyState === WebSocket.OPEN
        ) {
          try {
            ws.configureSession(language);
          } catch (error) {
            console.warn('更新語音會話設定時發生錯誤', error);
          }
        }
      },
      { flush: 'post' }
    );

    const getPreferredTheme = () => {
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') {
          return stored;
        }
      } catch (error) {
        console.warn('讀取主題偏好失敗', error);
      }
      const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    };

    const theme = ref(getPreferredTheme());
    const isDarkTheme = computed(() => theme.value === 'dark');
    const themeToggleLabel = computed(() =>
      isDarkTheme.value ? '切換至亮色模式' : '切換至深色模式'
    );

    const applyTheme = (value) => {
      const themeValue = value === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', themeValue);
      document.body?.setAttribute('data-theme', themeValue);
    };

    watch(
      theme,
      (value) => {
        applyTheme(value);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, value);
        } catch (error) {
          console.warn('儲存主題偏好失敗', error);
        }
      },
      { immediate: true }
    );

    try {
      const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
      const handleChange = (event) => {
        const stored = (() => {
          try {
            return localStorage.getItem(THEME_STORAGE_KEY);
          } catch (error) {
            console.warn('讀取主題偏好失敗', error);
            return null;
          }
        })();
        if (!stored) {
          theme.value = event.matches ? 'dark' : 'light';
        }
      };
      if (mediaQuery?.addEventListener) {
        mediaQuery.addEventListener('change', handleChange);
      } else if (mediaQuery?.addListener) {
        mediaQuery.addListener(handleChange);
      }
    } catch (error) {
      console.warn('監聽系統主題偏好失敗', error);
    }

    const toggleTheme = () => {
      theme.value = theme.value === 'dark' ? 'light' : 'dark';
    };

    const ws = createTransportContext('ws');
    const webrtc = createTransportContext('webrtc');

    const activeTransport = computed(() => (selectedMode.value === 'ws' ? ws : webrtc));

    const activeModeLabel = computed(() => MODE_LABELS[selectedMode.value]);

    const activeModeDescription = computed(() => {
      const option = MODE_OPTIONS.find((item) => item.id === selectedMode.value);
      return option?.description ?? '';
    });

    const isConnecting = computed(() => {
      const transport = activeTransport.value;
      return !!transport.connection && !transport.isReady;
    });

    const startLabel = computed(() => {
      const transport = activeTransport.value;
      if (transport.isReady) {
        return '已連線';
      }
      if (isConnecting.value) {
        return '連線中…';
      }
      return hasAttemptedConnection[selectedMode.value] ? '重新連線' : '連線';
    });

    const startDisabled = computed(
      () => activeTransport.value.isReady || isConnecting.value
    );

    const canSend = computed(() => activeTransport.value.isReady);

    const onStartClick = () => {
      hasAttemptedConnection[selectedMode.value] = true;
      if (selectedMode.value === 'ws') {
        stopWebRTCTransport(webrtc);
        startWebSocketTransport(ws, () => activeLanguage.value);
      } else {
        stopWebSocketTransport(ws);
        startWebRTCTransport(webrtc, () => activeLanguage.value);
      }
    };

    const sendMessage = () => {
      const text = message.value.trim();
      if (!text) {
        return;
      }

      const transport = activeTransport.value;
      const sent = transport.send ? transport.send(text) : false;

      if (!sent) {
        const errorText = '無法傳送訊息，請確認所選模式已連線。';
        appendMessage(transport, 'error', errorText);
        return;
      }

      message.value = '';
      if (messageInputRef.value) {
        messageInputRef.value.focus();
      }
    };

    const startVoiceRecording = async () => {
      if (selectedMode.value !== 'ws') {
        return;
      }
      if (typeof ws.startRecording !== 'function') {
        appendMessage(ws, 'error', '請先建立 WebSocket 連線再開始錄音。');
        return;
      }
      try {
        await ws.startRecording();
      } catch (error) {
        console.error('啟動語音錄製時發生錯誤', error);
        appendMessage(ws, 'error', '啟動語音錄製時發生錯誤，請稍後再試。');
      }
    };

    const stopVoiceRecording = async () => {
      if (selectedMode.value !== 'ws') {
        return;
      }
      if (typeof ws.stopRecording === 'function') {
        try {
          await ws.stopRecording();
        } catch (error) {
          console.error('停止語音錄製時發生錯誤', error);
          appendMessage(ws, 'error', '停止錄音時發生錯誤，請重新連線。');
        }
      }
    };

    watch(selectedMode, (next, previous) => {
      if (previous === next) {
        return;
      }
      if (previous === 'ws') {
        stopWebSocketTransport(ws);
      } else {
        stopWebRTCTransport(webrtc);
      }
      message.value = '';
    });

    return {
      message,
      messageInputRef,
      ws,
      webrtc,
      activeTransport,
      activeModeLabel,
      activeModeDescription,
      selectedMode,
      modeOptions: MODE_OPTIONS,
      MODE_LABELS,
      startLabel,
      startDisabled,
      canSend,
      onStartClick,
      sendMessage,
      startVoiceRecording,
      stopVoiceRecording,
      roleLabel,
      messageContainerClass,
      messageBubbleClass,
      languageOptions,
      selectedLanguageId,
      activeLanguage,
      theme,
      isDarkTheme,
      toggleTheme,
      themeToggleLabel,
    };
  },
});

app.mount('#app');
