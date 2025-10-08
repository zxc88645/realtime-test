function resolveReadyState(socket, stateName, fallback) {
  if (!socket || typeof socket[stateName] !== 'number') {
    return fallback;
  }
  return socket[stateName];
}

function isSocketOpen(socket) {
  if (!socket) {
    return false;
  }
  const openState = resolveReadyState(socket, 'OPEN', 1);
  return socket.readyState === openState;
}

function isSocketConnecting(socket) {
  if (!socket) {
    return false;
  }
  const connectingState = resolveReadyState(socket, 'CONNECTING', 0);
  return socket.readyState === connectingState;
}

function normalizeMessagePayload(payload) {
  if (typeof payload === 'string') {
    return payload;
  }
  if (Buffer.isBuffer(payload)) {
    return payload.toString('utf8');
  }
  if (payload && typeof payload === 'object') {
    if (typeof payload.data === 'string') {
      return payload.data;
    }
    if (Buffer.isBuffer(payload.data)) {
      return payload.data.toString('utf8');
    }
    if (typeof payload.toString === 'function' && payload !== payload.toString()) {
      return payload.toString();
    }
  }
  return '';
}

function resolveRealtimeWebSocketUrl(realtimeBaseUrl, realtimeModel, realtimeVoice) {
  if (!realtimeBaseUrl) {
    return undefined;
  }

  try {
    const url = new URL(realtimeBaseUrl);
    if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    } else if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    }

    if (realtimeModel) {
      url.searchParams.set('model', realtimeModel);
    }
    if (realtimeVoice) {
      url.searchParams.set('voice', realtimeVoice);
    }

    return url.toString();
  } catch (_error) {
    return undefined;
  }
}

let CachedRealtimeTransportClass;

function resolveDefaultRealtimeTransport() {
  if (!CachedRealtimeTransportClass) {
    ({
      OpenAIRealtimeWebSocket: CachedRealtimeTransportClass,
    } = require('@openai/agents-realtime'));
  }
  return new CachedRealtimeTransportClass();
}

function createRealtimeWebSocketHandler(options) {
  const {
    apiKey,
    realtimeModel,
    realtimeVoice,
    realtimeBaseUrl,
    createRealtimeTransport,
  } = options;

  const upstreamUrl = resolveRealtimeWebSocketUrl(
    realtimeBaseUrl,
    realtimeModel,
    realtimeVoice
  );

  const createTransport =
    typeof createRealtimeTransport === 'function'
      ? createRealtimeTransport
      : () => resolveDefaultRealtimeTransport();

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

    let upstreamTransport;
    try {
      upstreamTransport = createTransport();
    } catch (error) {
      console.error('建立 OpenAI 即時傳輸層時發生錯誤', error);
      if (isSocketOpen(clientSocket) || isSocketConnecting(clientSocket)) {
        clientSocket.send(
          JSON.stringify({
            type: 'error',
            error: { message: 'OpenAI 即時連線初始化失敗。' },
          })
        );
        clientSocket.close();
      }
      return;
    }

    const pendingMessages = [];
    const upstreamListeners = [];

    const addUpstreamListener = (socket, event, handler) => {
      if (!socket) {
        return;
      }
      if (typeof socket.addEventListener === 'function') {
        socket.addEventListener(event, handler);
        upstreamListeners.push(() => {
          try {
            socket.removeEventListener(event, handler);
          } catch (_error) {
            // ignore listener removal error
          }
        });
        return;
      }

      if (typeof socket.on === 'function') {
        socket.on(event, handler);
        upstreamListeners.push(() => {
          try {
            if (typeof socket.off === 'function') {
              socket.off(event, handler);
            } else if (typeof socket.removeListener === 'function') {
              socket.removeListener(event, handler);
            }
          } catch (_error) {
            // ignore listener removal error
          }
        });
      }
    };

    const detachUpstreamListeners = () => {
      while (upstreamListeners.length) {
        const remove = upstreamListeners.pop();
        try {
          remove();
        } catch (_error) {
          // ignore listener removal error
        }
      }
    };

    const flushPendingMessages = (socket) => {
      if (!socket) {
        return;
      }
      while (pendingMessages.length && upstreamTransport?.status === 'connected') {
        const payload = pendingMessages.shift();
        try {
          socket.send(payload);
        } catch (error) {
          console.warn('傳送暫存訊息至上游時失敗', error);
          pendingMessages.unshift(payload);
          break;
        }
      }
    };

    const handleUpstreamClose = (code, reason) => {
      const readableReason = Buffer.isBuffer(reason)
        ? reason.toString('utf8')
        : typeof reason === 'string'
          ? reason
          : '';
      console.log('上游 WebSocket 已關閉', code, readableReason);
      detachUpstreamListeners();
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
    };

    const handleUpstreamError = (error) => {
      console.error('上游 WebSocket 發生錯誤', error);
      detachUpstreamListeners();
      if (isSocketOpen(clientSocket)) {
        clientSocket.send(
          JSON.stringify({
            type: 'error',
            error: { message: 'OpenAI 即時連線失敗。' },
          })
        );
        clientSocket.close();
      }
    };

    const sendSessionUpdate = () => {
      if (typeof upstreamTransport?.sendEvent !== 'function') {
        return;
      }

      try {
        upstreamTransport.sendEvent({
          type: 'session.update',
          session: {
            voice: realtimeVoice,
            instructions: '此連線由伺服器代理建立，請啟用語音回應。',
          },
        });
      } catch (error) {
        console.warn('傳送 session.update 事件時發生錯誤', error);
      }
    };

    const connectPromise = upstreamTransport
      .connect({
        apiKey,
        model: realtimeModel,
        url: upstreamUrl,
      })
      .then(() => {
        const upstreamSocket = upstreamTransport.connectionState?.websocket;
        if (!upstreamSocket) {
          throw new Error('OpenAI WebSocket 尚未建立');
        }

        addUpstreamListener(upstreamSocket, 'message', (message) => {
          const payload = normalizeMessagePayload(message);
          if (!payload) {
            return;
          }
          if (isSocketOpen(clientSocket)) {
            try {
              clientSocket.send(payload);
            } catch (error) {
              console.warn('轉送上游訊息至用戶端時發生錯誤', error);
            }
          }
        });

        addUpstreamListener(upstreamSocket, 'close', handleUpstreamClose);
        addUpstreamListener(upstreamSocket, 'error', handleUpstreamError);

        sendSessionUpdate();

        if (isSocketOpen(clientSocket)) {
          try {
            clientSocket.send(
              JSON.stringify({
                type: 'server.status',
                status: '已連線至 OpenAI（語音已啟用）',
              })
            );
          } catch (error) {
            console.warn('傳送狀態訊息給用戶端時失敗', error);
          }
        }

        flushPendingMessages(upstreamSocket);
      })
      .catch((error) => {
        console.error('連線至 OpenAI 即時服務失敗', error);
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
      const payload = normalizeMessagePayload(message);
      if (!payload) {
        return;
      }

      const upstreamSocket = upstreamTransport.connectionState?.websocket;
      if (upstreamSocket && upstreamTransport.status === 'connected') {
        try {
          upstreamSocket.send(payload);
        } catch (error) {
          console.warn('傳送訊息至上游時發生錯誤', error);
        }
      } else {
        pendingMessages.push(payload);
      }
    });

    clientSocket.on('close', () => {
      console.log('WebSocket 用戶端已離線');
      pendingMessages.length = 0;
      detachUpstreamListeners();
      try {
        upstreamTransport.close();
      } catch (error) {
        console.warn('關閉上游連線時發生錯誤', error);
      }
    });

    clientSocket.on('error', (error) => {
      console.error('用戶端 WebSocket 發生錯誤', error);
      pendingMessages.length = 0;
      detachUpstreamListeners();
      try {
        upstreamTransport.close();
      } catch (closeError) {
        console.warn('關閉上游連線時發生錯誤', closeError);
      }
    });

    return connectPromise;
  };
}

module.exports = { createRealtimeWebSocketHandler };
