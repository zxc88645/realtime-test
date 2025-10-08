const { WebSocket } = require('ws');

function createRealtimeWebSocketHandler(options) {
  const { apiKey, realtimeModel, realtimeBaseUrl } = options;

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

    const upstreamUrl = `${realtimeBaseUrl}?model=${encodeURIComponent(
      realtimeModel
    )}`;
    const upstream = new WebSocket(upstreamUrl, {
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
      while (pendingMessages.length && upstream.readyState === WebSocket.OPEN) {
        upstream.send(pendingMessages.shift());
      }
    });

    upstream.on('message', (message) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
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
      if (clientSocket.readyState === WebSocket.OPEN) {
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
      if (clientSocket.readyState === WebSocket.OPEN) {
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
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(message);
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        pendingMessages.push(message);
      }
    });

    clientSocket.on('close', () => {
      console.log('WebSocket 用戶端已離線');
      pendingMessages.length = 0;
      if (
        upstream.readyState === WebSocket.OPEN ||
        upstream.readyState === WebSocket.CONNECTING
      ) {
        upstream.close();
      }
    });

    clientSocket.on('error', (error) => {
      console.error('用戶端 WebSocket 發生錯誤', error);
      if (
        upstream.readyState === WebSocket.OPEN ||
        upstream.readyState === WebSocket.CONNECTING
      ) {
        upstream.close();
      }
    });
  };
}

module.exports = { createRealtimeWebSocketHandler };
