const EventEmitter = require('events');
const request = require('supertest');
const {
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
} = require('../src/config/constants');
const { createRealtimeServer, REALTIME_CLIENT_SECRETS_PATH } = require('../server');
const {
  createRealtimeWebSocketHandler,
} = require('../src/websocket/createRealtimeWebSocketHandler');

class MockSocket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.closed = false;
    this.readyState = MockSocket.CONNECTING;
  }

  send(payload) {
    this.sent.push(payload);
  }

  close(code, reason) {
    if (this.readyState === MockSocket.CLOSED) {
      return;
    }
    this.closed = true;
    this.readyState = MockSocket.CLOSED;
    this.emit('close', code, reason);
  }

  triggerOpen() {
    this.readyState = MockSocket.OPEN;
    this.emit('open');
  }

  triggerMessage(payload) {
    this.emit('message', payload);
  }

  triggerClose(code = 1000, reason = '') {
    this.readyState = MockSocket.CLOSED;
    this.emit('close', code, reason);
  }

  triggerError(error) {
    this.emit('error', error);
  }

  addEventListener(event, handler) {
    this.on(event, handler);
  }

  removeEventListener(event, handler) {
    this.off(event, handler);
  }
}

MockSocket.CONNECTING = 0;
MockSocket.OPEN = 1;
MockSocket.CLOSING = 2;
MockSocket.CLOSED = 3;

class MockRealtimeTransport {
  constructor(socket) {
    this.socket = socket;
    this.status = 'disconnected';
    this.connectionState = { status: 'disconnected', websocket: undefined };
    this.sendEvent = jest.fn();
    this.close = jest.fn(() => {
      this.status = 'disconnected';
      if (
        this.connectionState.websocket &&
        typeof this.connectionState.websocket.close === 'function'
      ) {
        this.connectionState.websocket.close();
      }
    });
  }

  async connect(options) {
    this.connectOptions = options;
    this.status = 'connecting';
    return new Promise((resolve) => {
      setImmediate(() => {
        this.status = 'connected';
        this.connectionState = { status: 'connected', websocket: this.socket };
        if (typeof this.socket.triggerOpen === 'function') {
          this.socket.triggerOpen();
        }
        resolve();
      });
    });
  }
}

describe('createRealtimeServer', () => {
  test('回報缺少金鑰的錯誤訊息', async () => {
    const { app, server } = createRealtimeServer({ apiKey: null });

    const response = await request(app).post(REALTIME_CLIENT_SECRETS_PATH);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '伺服器缺少 OPENAI_API_KEY' });

    try {
      server.close();
    } catch (error) {
      if (error?.code !== 'ERR_SERVER_NOT_RUNNING') {
        throw error;
      }
    }
  });

  test('成功取得短效金鑰時回傳資料', async () => {
    const fakeClient = {
      realtime: {
        clientSecrets: {
          create: jest.fn().mockResolvedValue({
            id: 'session-id',
            client_secret: { value: 'secret-token', expires_at: 1234567890 },
          }),
        },
      },
    };

    const createOpenAIClient = jest.fn(() => fakeClient);

    const { app, server } = createRealtimeServer({
      apiKey: 'test-key',
      createOpenAIClient,
    });

    const response = await request(app).post(REALTIME_CLIENT_SECRETS_PATH);

    expect(createOpenAIClient).toHaveBeenCalled();
    expect(fakeClient.realtime.clientSecrets.create).toHaveBeenCalledWith({
      model: DEFAULT_REALTIME_MODEL,
      voice: DEFAULT_REALTIME_VOICE,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      client_secret: {
        value: 'secret-token',
        expires_at: 1234567890,
      },
    });

    try {
      server.close();
    } catch (error) {
      if (error?.code !== 'ERR_SERVER_NOT_RUNNING') {
        throw error;
      }
    }
  });

  test('上游回應錯誤時回報詳細訊息', async () => {
    const upstreamError = new Error('unauthorized');
    upstreamError.status = 401;
    upstreamError.error = { message: 'unauthorized' };

    const fakeClient = {
      realtime: {
        clientSecrets: {
          create: jest.fn().mockRejectedValue(upstreamError),
        },
      },
    };

    const createOpenAIClient = jest.fn(() => fakeClient);

    const { app, server } = createRealtimeServer({
      apiKey: 'test-key',
      createOpenAIClient,
    });

    const response = await request(app).post(REALTIME_CLIENT_SECRETS_PATH);

    expect(createOpenAIClient).toHaveBeenCalled();
    expect(fakeClient.realtime.clientSecrets.create).toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: '建立短效會話失敗',
      details: 'unauthorized',
    });

    try {
      server.close();
    } catch (error) {
      if (error?.code !== 'ERR_SERVER_NOT_RUNNING') {
        throw error;
      }
    }
  });
});

describe('createRealtimeWebSocketHandler', () => {
  test('缺少 API 金鑰時回傳錯誤並關閉連線', () => {
    const handler = createRealtimeWebSocketHandler({
      apiKey: null,
      realtimeModel: 'test-model',
      realtimeVoice: 'verse',
      realtimeBaseUrl: 'wss://example',
    });

    const clientSocket = new MockSocket();
    handler(clientSocket);

    expect(clientSocket.sent).toHaveLength(1);
    expect(JSON.parse(clientSocket.sent[0])).toEqual({
      type: 'error',
      error: { message: '伺服器缺少 OPENAI_API_KEY' },
    });
    expect(clientSocket.closed).toBe(true);
  });

  test('成功連線後會回傳狀態並轉發訊息', async () => {
    const upstreamSocket = new MockSocket();
    const createRealtimeTransport = jest.fn(
      () => new MockRealtimeTransport(upstreamSocket)
    );

    const handler = createRealtimeWebSocketHandler({
      apiKey: 'key',
      realtimeModel: 'test-model',
      realtimeVoice: 'verse',
      realtimeBaseUrl: 'https://example',
      createRealtimeTransport,
    });

    const clientSocket = new MockSocket();
    clientSocket.readyState = MockSocket.OPEN;
    const connectPromise = handler(clientSocket);

    expect(createRealtimeTransport).toHaveBeenCalledTimes(1);

    clientSocket.emit('message', 'queued-message');

    await new Promise((resolve) => setImmediate(resolve));

    const transport = createRealtimeTransport.mock.results[0].value;
    expect(transport.connectOptions).toMatchObject({
      apiKey: 'key',
      model: 'test-model',
    });
    expect(transport.connectOptions.url).toContain('model=test-model');
    expect(transport.connectOptions.url).toContain('voice=verse');
    expect(transport.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session.update' })
    );

    expect(clientSocket.sent).toContainEqual(
      expect.stringContaining('"type":"server.status"')
    );
    expect(upstreamSocket.sent).toContain('queued-message');

    upstreamSocket.triggerMessage('server-payload');
    expect(clientSocket.sent).toContain('server-payload');

    upstreamSocket.triggerClose(4000, Buffer.from('bye'));
    expect(clientSocket.closed).toBe(true);
    const statusPayload = clientSocket.sent.find(
      (item) => item.includes('"status"') && item.includes('bye')
    );
    expect(statusPayload).toBeTruthy();

    await connectPromise;
  });

  test('自訂傳輸層可取得連線參數', async () => {
    const upstreamSocket = new MockSocket();
    const createRealtimeTransport = jest.fn(
      () => new MockRealtimeTransport(upstreamSocket)
    );

    const handler = createRealtimeWebSocketHandler({
      apiKey: 'key',
      realtimeModel: 'test-model',
      realtimeVoice: 'verse',
      realtimeBaseUrl: 'wss://example',
      createRealtimeTransport,
    });

    const clientSocket = new MockSocket();
    clientSocket.readyState = MockSocket.OPEN;
    const connectPromise = handler(clientSocket);

    await new Promise((resolve) => setImmediate(resolve));

    const transport = createRealtimeTransport.mock.results[0].value;
    expect(transport.connectOptions).toEqual({
      apiKey: 'key',
      model: 'test-model',
      url: expect.stringContaining('voice=verse'),
    });

    await connectPromise;
  });
});
