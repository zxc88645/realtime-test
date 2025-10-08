const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const DEFAULT_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const OPENAI_REALTIME_BASE_URL = 'https://api.openai.com/v1/realtime';

const REALTIME_PATH = '/openai/agents/realtime';
const REALTIME_WS_PATH = `${REALTIME_PATH}/ws`;
const REALTIME_EPHEMERAL_PATH = `${REALTIME_PATH}/ephemeral-token`;

function createRealtimeServer(options = {}) {
  const {
    port = DEFAULT_PORT,
    apiKey = DEFAULT_API_KEY,
    realtimeModel = DEFAULT_REALTIME_MODEL,
    fetchImpl = global.fetch,
  } = options;

  if (typeof fetchImpl !== 'function') {
    throw new Error('環境缺少 fetch 實作');
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  const server = http.createServer(app);
  const webSocketServer = new WebSocketServer({ noServer: true });

  webSocketServer.on('connection', (clientSocket) => {
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

    const upstreamUrl = `${OPENAI_REALTIME_BASE_URL}?model=${encodeURIComponent(
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
  });

  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      ({ pathname } = new URL(request.url, `http://${request.headers.host}`));
    } catch (error) {
      socket.destroy();
      return;
    }

    if (pathname === REALTIME_WS_PATH) {
      webSocketServer.handleUpgrade(request, socket, head, (socket) => {
        webSocketServer.emit('connection', socket, request);
      });
    } else {
      socket.destroy();
    }
  });

  app.post(REALTIME_EPHEMERAL_PATH, async (_req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: '伺服器缺少 OPENAI_API_KEY' });
      return;
    }

    try {
      const response = await fetchImpl('https://api.openai.com/v1/realtime/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: realtimeModel,
          voice: 'verse',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('建立短效會話失敗', response.status, errorText);
        res
          .status(response.status)
          .json({ error: '建立短效會話失敗', details: errorText });
        return;
      }

      const data = await response.json();
      res.json({
        id: data.id,
        client_secret: data.client_secret,
        expires_at: data.client_secret?.expires_at ?? null,
      });
    } catch (error) {
      console.error('建立短效會話時發生錯誤', error);
      res.status(500).json({ error: '建立短效會話時發生錯誤' });
    }
  });

  const start = (listenPort = port) =>
    server.listen(listenPort, () => {
      console.log(`伺服器已在 http://localhost:${listenPort} 上啟動`);
    });

  return { app, server, webSocketServer, start };
}

if (require.main === module) {
  const { start } = createRealtimeServer();
  start();
}

module.exports = {
  createRealtimeServer,
  REALTIME_WS_PATH,
  REALTIME_EPHEMERAL_PATH,
};
