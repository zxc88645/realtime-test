const REALTIME_MODEL = 'gpt-4o-realtime-preview-2024-12-17';
const REALTIME_BASE_URL = 'https://api.openai.com/v1/realtime';
const REALTIME_WS_PATH = '/openai/agents/realtime/ws';
const REALTIME_EPHEMERAL_PATH = '/openai/agents/realtime/ephemeral-token';

function createLatencyTracker(root) {
  const statusEl = root.querySelector('.status');
  const latestEl = root.querySelector('.latest');
  const averageEl = root.querySelector('.average');
  const samplesEl = root.querySelector('.samples');

  const latencies = [];

  return {
    setStatus(status) {
      statusEl.textContent = status;
    },
    recordLatency(duration) {
      latencies.push(duration);
      const average = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
      latestEl.textContent = `${duration.toFixed(2)} 毫秒`;
      averageEl.textContent = `${average.toFixed(2)} 毫秒`;
      samplesEl.textContent = String(latencies.length);
    },
    reset() {
      latencies.length = 0;
      latestEl.textContent = '–';
      averageEl.textContent = '–';
      samplesEl.textContent = '0';
    },
  };
}

const ROLE_LABELS = {
  user: '你',
  'gpt-ws': 'GPT（WebSocket）',
  'gpt-webrtc': 'GPT（WebRTC）',
  error: '錯誤',
};

function appendMessage(container, role, text = '') {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const roleEl = document.createElement('span');
  roleEl.className = 'message-role';
  roleEl.textContent = ROLE_LABELS[role] ?? role;

  const textEl = document.createElement('span');
  textEl.className = 'message-text';
  textEl.textContent = text;

  wrapper.append(roleEl, textEl);
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;

  return { wrapper, textEl };
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

function createTransportState({ id, tracker, messagesEl }) {
  return {
    id,
    tracker,
    messagesEl,
    isReady: false,
    connection: null,
    pendingMessages: new Map(),
    responsesById: new Map(),
  };
}

function ensureResponseEntry(state, event) {
  const response = event?.response;
  if (!response?.id) {
    return null;
  }
  let entry = state.responsesById.get(response.id);
  if (!entry) {
    const clientMessageId = response.metadata?.client_message_id;
    const { textEl } = appendMessage(
      state.messagesEl,
      state.id === 'ws' ? 'gpt-ws' : 'gpt-webrtc'
    );
    entry = {
      clientMessageId,
      text: '',
      textEl,
    };
    state.responsesById.set(response.id, entry);
  } else if (!entry.clientMessageId && response.metadata?.client_message_id) {
    entry.clientMessageId = response.metadata.client_message_id;
  }
  return entry;
}

function handleRealtimeEvent(state, event) {
  if (!event || typeof event !== 'object') {
    return;
  }

  if (event.type === 'error') {
    const message = event.error?.message || event.message || '發生未知的即時錯誤';
    appendMessage(state.messagesEl, 'error', message);
    state.tracker.setStatus('錯誤');
    return;
  }

  if (event.type === 'server.status') {
    if (typeof event.status === 'string') {
      state.tracker.setStatus(event.status);
    }
    return;
  }

  const entry = ensureResponseEntry(state, event);
  if (!entry) {
    return;
  }

  if (event.type === 'response.delta' || event.type === 'response.output_text.delta') {
    const fragment = extractDeltaText(event);
    if (fragment) {
      entry.text += fragment;
      entry.textEl.textContent = entry.text;
    }
  } else if (event.type === 'response.completed') {
    const finalText = extractCompletedText(event, entry.text);
    entry.text = finalText;
    entry.textEl.textContent = finalText;
    if (entry.clientMessageId && state.pendingMessages.has(entry.clientMessageId)) {
      const started = state.pendingMessages.get(entry.clientMessageId).start;
      state.tracker.recordLatency(performance.now() - started);
      state.pendingMessages.delete(entry.clientMessageId);
    }
    state.responsesById.delete(event.response.id);
  } else if (event.type === 'response.error') {
    const message = event.error?.message || '模型無法產生回應。';
    appendMessage(state.messagesEl, 'error', message);
    if (entry.clientMessageId && state.pendingMessages.has(entry.clientMessageId)) {
      state.pendingMessages.delete(entry.clientMessageId);
    }
    state.responsesById.delete(event.response.id);
  }
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

const startButton = document.querySelector('#start');
const messageForm = document.querySelector('#message-form');
const messageInput = document.querySelector('#message');
const sendButton = document.querySelector('#send');

const wsTracker = createLatencyTracker(document.querySelector('#ws-result'));
const webrtcTracker = createLatencyTracker(document.querySelector('#webrtc-result'));

const wsMessagesEl = document.querySelector('#ws-result .messages');
const webrtcMessagesEl = document.querySelector('#webrtc-result .messages');

const wsState = createTransportState({
  id: 'ws',
  tracker: wsTracker,
  messagesEl: wsMessagesEl,
});
const webrtcState = createTransportState({
  id: 'webrtc',
  tracker: webrtcTracker,
  messagesEl: webrtcMessagesEl,
});

let hasAttemptedConnection = false;

function updateSendControls() {
  const ready = wsState.isReady || webrtcState.isReady;
  messageInput.disabled = !ready;
  sendButton.disabled = !ready;
}

function updateStartButton() {
  const connecting =
    (wsState.connection && !wsState.isReady) ||
    (webrtcState.connection && !webrtcState.isReady);

  if (wsState.isReady || webrtcState.isReady) {
    startButton.textContent = '已連線';
    startButton.disabled = true;
  } else if (connecting) {
    startButton.textContent = '連線中…';
    startButton.disabled = true;
  } else {
    startButton.textContent = hasAttemptedConnection ? '重新連線' : '連線';
    startButton.disabled = false;
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

function startWebSocketTransport() {
  wsTracker.reset();
  wsTracker.setStatus('連線中…');

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}${REALTIME_WS_PATH}`);
  wsState.connection = socket;
  updateStartButton();

  const queue = [];

  socket.addEventListener('open', () => {
    wsState.isReady = true;
    wsTracker.setStatus('已連線');
    updateSendControls();
    updateStartButton();
    while (queue.length && socket.readyState === WebSocket.OPEN) {
      socket.send(queue.shift());
    }
  });

  socket.addEventListener('message', async (event) => {
    try {
      const payload = await parseEventData(event.data);
      handleRealtimeEvent(wsState, payload);
    } catch (error) {
      console.error('解析 WebSocket 負載時發生錯誤', error);
    }
  });

  socket.addEventListener('close', () => {
    wsState.isReady = false;
    wsState.connection = null;
    wsState.send = undefined;
    wsState.pendingMessages.clear();
    updateSendControls();
    if (wsTracker) {
      wsTracker.setStatus('已關閉');
    }
    updateStartButton();
  });

  socket.addEventListener('error', (error) => {
    console.error('WebSocket 傳輸發生錯誤', error);
    wsTracker.setStatus('錯誤（詳見主控台）');
    updateStartButton();
  });

  wsState.send = (text) => {
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
    wsState.pendingMessages.set(clientMessageId, {
      start: performance.now(),
    });
    appendMessage(wsState.messagesEl, 'user', message);
    return true;
  };
}

async function startWebRTCTransport() {
  webrtcTracker.reset();
  webrtcTracker.setStatus('取得金鑰中…');

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
    appendMessage(webrtcState.messagesEl, 'error', error.message || '取得短效金鑰失敗');
    webrtcTracker.setStatus('錯誤（金鑰）');
    updateStartButton();
    return;
  }

  const peerConnection = new RTCPeerConnection();
  webrtcState.connection = peerConnection;
  updateStartButton();

  const dataChannel = peerConnection.createDataChannel('oai-events');
  webrtcState.dataChannel = dataChannel;

  dataChannel.addEventListener('open', () => {
    webrtcState.isReady = true;
    webrtcTracker.setStatus('已連線');
    updateSendControls();
    updateStartButton();
  });

  dataChannel.addEventListener('message', async (event) => {
    try {
      const payload = await parseEventData(event.data);
      handleRealtimeEvent(webrtcState, payload);
    } catch (error) {
      console.error('解析資料通道負載時發生錯誤', error);
    }
  });

  dataChannel.addEventListener('close', () => {
    webrtcState.isReady = false;
    webrtcState.dataChannel = null;
    webrtcState.connection = null;
    webrtcState.send = undefined;
    webrtcState.pendingMessages.clear();
    try {
      peerConnection.close();
    } catch (error) {
      console.warn('關閉對等連線時發生錯誤', error);
    }
    updateSendControls();
    webrtcTracker.setStatus('已關閉');
    updateStartButton();
  });

  dataChannel.addEventListener('error', (error) => {
    console.error('資料通道發生錯誤', error);
    webrtcTracker.setStatus('錯誤（詳見主控台）');
    updateStartButton();
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

    webrtcTracker.setStatus('協商中…');

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
    webrtcTracker.setStatus('等待資料通道…');
  } catch (error) {
    console.error('WebRTC 協商失敗', error);
    appendMessage(webrtcState.messagesEl, 'error', error.message || 'WebRTC 協商失敗');
    webrtcTracker.setStatus('錯誤（詳見主控台）');
    peerConnection.close();
    webrtcState.connection = null;
    webrtcState.dataChannel = null;
    webrtcState.send = undefined;
    webrtcState.pendingMessages.clear();
    updateSendControls();
    updateStartButton();
    return;
  }

  webrtcState.send = (text) => {
    const channel = webrtcState.dataChannel;
    if (!channel || channel.readyState !== 'open') {
      return false;
    }
    const message = text.trim();
    if (!message) {
      return false;
    }
    const clientMessageId = crypto.randomUUID();
    channel.send(JSON.stringify(buildResponseCreateEvent(message, clientMessageId)));
    webrtcState.pendingMessages.set(clientMessageId, {
      start: performance.now(),
    });
    appendMessage(webrtcState.messagesEl, 'user', message);
    return true;
  };
}

startButton.addEventListener('click', () => {
  startButton.disabled = true;
  hasAttemptedConnection = true;
  startButton.textContent = '連線中…';
  startWebSocketTransport();
  startWebRTCTransport();
  updateStartButton();
});

messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  const sentViaWS = wsState.send ? wsState.send(text) : false;
  const sentViaWebRTC = webrtcState.send ? webrtcState.send(text) : false;

  if (!sentViaWS && !sentViaWebRTC) {
    const errorText = '無法傳送訊息，請確認至少有一種傳輸方式已連線。';
    appendMessage(wsState.messagesEl, 'error', errorText);
    appendMessage(webrtcState.messagesEl, 'error', errorText);
    return;
  }

  messageInput.value = '';
  messageInput.focus();
});

updateSendControls();
updateStartButton();
