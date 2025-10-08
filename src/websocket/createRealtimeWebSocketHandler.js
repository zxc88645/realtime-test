const { WebSocket } = require('ws');

function createRealtimeWebSocketHandler(options) {
  const {
    apiKey,
    realtimeModel,
    realtimeVoice,
    realtimeBaseUrl,
    webSocketImpl = WebSocket,
    createUpstream = (url, config) => new webSocketImpl(url, config),
  } = options;

  const READY_STATE = {
    CONNECTING:
      typeof webSocketImpl.CONNECTING === 'number'
        ? webSocketImpl.CONNECTING
        : WebSocket.CONNECTING,
    OPEN: typeof webSocketImpl.OPEN === 'number' ? webSocketImpl.OPEN : WebSocket.OPEN,
    CLOSING:
      typeof webSocketImpl.CLOSING === 'number'
        ? webSocketImpl.CLOSING
        : WebSocket.CLOSING,
    CLOSED:
      typeof webSocketImpl.CLOSED === 'number' ? webSocketImpl.CLOSED : WebSocket.CLOSED,
  };

  const isSocketOpen = (socket) => socket?.readyState === READY_STATE.OPEN;
  const isSocketConnecting = (socket) => socket?.readyState === READY_STATE.CONNECTING;

  return (clientSocket) => {
    console.log('WebSocket 用戶端已連線');

    if (!apiKey) {
      clientSocket.send(
        JSON.stringify({
          type: 'error',
          error: { message: '伺服器缺少 OPENAI_API_KEY' },
        })
      );
      clientSocket.close();
      return;
    }

    const upstreamUrl = new URL(realtimeBaseUrl);
    upstreamUrl.searchParams.set('model', realtimeModel);
    if (realtimeVoice) {
      upstreamUrl.searchParams.set('voice', realtimeVoice);
    }

    const upstream = createUpstream(upstreamUrl.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    const pendingMessages = [];

    upstream.on('open', () => {
      console.log('已連線至 OpenAI 即時 WebSocket');
      try {
        clientSocket.send(
          JSON.stringify({ type: 'server.status', status: '已連線至 OpenAI' })
        );
      } catch (error) {
        console.warn('傳送狀態訊息給用戶端時失敗', error);
      }
      while (pendingMessages.length && isSocketOpen(upstream)) {
        upstream.send(pendingMessages.shift());
      }
    });

    upstream.on('message', (message) => {
      if (isSocketOpen(clientSocket)) {
        clientSocket.send(message);
      }
    });

    upstream.on('close', (code, reason) => {
      const readableReason = Buffer.isBuffer(reason)
        ? reason.toString('utf8')
        : typeof reason === 'string'
          ? reason
          : '';
      console.log('上游 WebSocket 已關閉', code, readableReason);
      if (isSocketOpen(clientSocket)) {
        clientSocket.send(
          JSON.stringify({
            type: 'server.status',
            status: readableReason || 'OpenAI 連線已關閉',
            code,
          })
        );
        clientSocket.close();
      }
    });

    upstream.on('error', (error) => {
      console.error('上游 WebSocket 發生錯誤', error);
      if (isSocketOpen(clientSocket)) {
        clientSocket.send(
          JSON.stringify({
            type: 'error',
            error: { message: 'OpenAI 即時連線失敗。' },
          })
        );
        clientSocket.close();
      }
    });

    clientSocket.on('message', (message) => {
      if (isSocketOpen(upstream)) {
        upstream.send(message);
      } else if (isSocketConnecting(upstream)) {
        pendingMessages.push(message);
      }
    });

    clientSocket.on('close', () => {
      console.log('WebSocket 用戶端已離線');
      pendingMessages.length = 0;
      if (isSocketOpen(upstream) || isSocketConnecting(upstream)) {
        upstream.close();
      }
    });

    clientSocket.on('error', (error) => {
      console.error('用戶端 WebSocket 發生錯誤', error);
      if (isSocketOpen(upstream) || isSocketConnecting(upstream)) {
        upstream.close();
      }
    });
  };
}

module.exports = { createRealtimeWebSocketHandler };
