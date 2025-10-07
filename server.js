const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const OPENAI_REALTIME_BASE_URL = 'https://api.openai.com/v1/realtime';

const REALTIME_PATH = '/openai/agents/realtime';
const REALTIME_WS_PATH = `${REALTIME_PATH}/ws`;
const REALTIME_EPHEMERAL_PATH = `${REALTIME_PATH}/ephemeral-token`;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

const webSocketServer = new WebSocketServer({ noServer: true });

webSocketServer.on('connection', (clientSocket) => {
  console.log('WebSocket client connected');

  if (!OPENAI_API_KEY) {
    clientSocket.send(
      JSON.stringify({
        type: 'error',
        error: { message: 'Server is missing OPENAI_API_KEY' },
      })
    );
    clientSocket.close();
    return;
  }

  const upstreamUrl = `${OPENAI_REALTIME_BASE_URL}?model=${encodeURIComponent(
    OPENAI_REALTIME_MODEL
  )}`;
  const upstream = new WebSocket(upstreamUrl, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  const pendingMessages = [];

  upstream.on('open', () => {
    console.log('Connected to OpenAI realtime WebSocket');
    try {
      clientSocket.send(
        JSON.stringify({ type: 'server.status', status: 'Connected to OpenAI' })
      );
    } catch (error) {
      console.warn('Failed to send status message to client', error);
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
    console.log('Upstream WebSocket closed', code, readableReason);
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(
        JSON.stringify({
          type: 'server.status',
          status: readableReason || 'OpenAI connection closed',
          code,
        })
      );
      clientSocket.close();
    }
  });

  upstream.on('error', (error) => {
    console.error('Upstream WebSocket error', error);
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(
        JSON.stringify({
          type: 'error',
          error: { message: 'OpenAI realtime connection failed.' },
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
    console.log('WebSocket client disconnected');
    pendingMessages.length = 0;
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  });

  clientSocket.on('error', (error) => {
    console.error('Client WebSocket error', error);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
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
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: 'Server is missing OPENAI_API_KEY' });
    return;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_REALTIME_MODEL,
        voice: 'verse',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to create ephemeral session', response.status, errorText);
      res
        .status(response.status)
        .json({ error: 'Failed to create ephemeral session', details: errorText });
      return;
    }

    const data = await response.json();
    res.json({
      id: data.id,
      client_secret: data.client_secret,
      expires_at: data.client_secret?.expires_at ?? null,
    });
  } catch (error) {
    console.error('Error creating ephemeral session', error);
    res.status(500).json({ error: 'Error creating ephemeral session' });
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
