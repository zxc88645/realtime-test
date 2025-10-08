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
    description: '透過伺服器橋接至 OpenAI Realtime API。',
  },
  {
    id: 'webrtc',
    label: MODE_LABELS.webrtc,
    description: '使用瀏覽器直接與模型建立資料通道。',
  },
];

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

  if (event.type === 'server.status') {
    if (typeof event.status === 'string') {
      transport.status = event.status;
    }
    return;
  }

  const entry = ensureResponseEntry(transport, event);
  if (!entry) {
    return;
  }

  if (event.type === 'response.delta' || event.type === 'response.output_text.delta') {
    const fragment = extractDeltaText(event);
    if (fragment) {
      entry.message.text += fragment;
    }
  } else if (event.type === 'response.completed') {
    const finalText = extractCompletedText(event, entry.message.text);
    entry.message.text = finalText;
    if (entry.clientMessageId && transport.pendingMessages.has(entry.clientMessageId)) {
      const started = transport.pendingMessages.get(entry.clientMessageId).start;
      recordLatency(transport, performance.now() - started);
      transport.pendingMessages.delete(entry.clientMessageId);
    }
    transport.responsesById.delete(event.response.id);
  } else if (event.type === 'response.error') {
    const message = event.error?.message || '模型無法產生回應。';
    appendMessage(transport, 'error', message);
    if (entry.clientMessageId && transport.pendingMessages.has(entry.clientMessageId)) {
      transport.pendingMessages.delete(entry.clientMessageId);
    }
    transport.responsesById.delete(event.response.id);
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

function buildResponseCreateEvent(text, clientMessageId) {
  return {
    type: 'response.create',
    response: {
      metadata: {
        client_message_id: clientMessageId,
      },
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text,
            },
          ],
        },
      ],
    },
  };
}

function stopWebSocketTransport(transport) {
  if (!transport) {
    return;
  }
  const hadConnection = !!transport.connection;
  transport.manualStop = hadConnection;
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

function startWebSocketTransport(transport) {
  if (transport.connection) {
    try {
      transport.connection.close();
    } catch (error) {
      console.warn('關閉既有 WebSocket 連線時發生錯誤', error);
    }
  }
  transport.connection = null;
  transport.send = undefined;
  transport.isReady = false;
  transport.pendingMessages.clear();
  transport.responsesById.clear();
  resetLatencies(transport);
  transport.status = '連線中…';

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}${REALTIME_WS_PATH}`);
  transport.connection = socket;

  const queue = [];

  socket.addEventListener('open', () => {
    transport.isReady = true;
    transport.status = '已連線';
    while (queue.length && socket.readyState === WebSocket.OPEN) {
      socket.send(queue.shift());
    }
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
    transport.connection = null;
    transport.send = undefined;
    transport.pendingMessages.clear();
    transport.responsesById.clear();
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
    const payload = JSON.stringify(buildResponseCreateEvent(message, clientMessageId));
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    } else if (socket.readyState === WebSocket.CONNECTING) {
      queue.push(payload);
    } else {
      return false;
    }
    transport.pendingMessages.set(clientMessageId, {
      start: performance.now(),
    });
    appendMessage(transport, 'user', message);
    return true;
  };
}

async function startWebRTCTransport(transport) {
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
    channel.send(JSON.stringify(buildResponseCreateEvent(message, clientMessageId)));
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

    const ws = createTransportContext('ws');
    const webrtc = createTransportContext('webrtc');

    const activeTransport = computed(() => (selectedMode.value === 'ws' ? ws : webrtc));

    const activeModeLabel = computed(() => MODE_LABELS[selectedMode.value]);

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
        startWebSocketTransport(ws);
      } else {
        stopWebSocketTransport(ws);
        startWebRTCTransport(webrtc);
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
      selectedMode,
      modeOptions: MODE_OPTIONS,
      MODE_LABELS,
      startLabel,
      startDisabled,
      canSend,
      onStartClick,
      sendMessage,
      roleLabel,
    };
  },
});

app.mount('#app');
