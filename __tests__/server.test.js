const EventEmitter = require('events');
const request = require('supertest');
const {
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
} = require('../src/config/constants');
const { createRealtimeServer, REALTIME_EPHEMERAL_PATH } = require('../server');
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
}

MockSocket.CONNECTING = 0;
MockSocket.OPEN = 1;
MockSocket.CLOSING = 2;
MockSocket.CLOSED = 3;

describe('createRealtimeServer', () => {
  test('回報缺少金鑰的錯誤訊息', async () => {
    const { app, server } = createRealtimeServer({ apiKey: null });

    const response = await request(app).post(REALTIME_EPHEMERAL_PATH);

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
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'session-id',
        client_secret: { value: 'secret-token', expires_at: 1234567890 },
      }),
      text: async () => '',
    });

    const { app, server } = createRealtimeServer({
      apiKey: 'test-key',
      fetchImpl: fakeFetch,
    });

    const response = await request(app).post(REALTIME_EPHEMERAL_PATH);

    expect(fakeFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/realtime/sessions',
      expect.objectContaining({ method: 'POST' })
    );
    const [, fetchOptions] = fakeFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchOptions.body);
    expect(requestBody).toEqual({
      model: DEFAULT_REALTIME_MODEL,
      voice: DEFAULT_REALTIME_VOICE,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 'session-id',
      client_secret: { value: 'secret-token', expires_at: 1234567890 },
      expires_at: 1234567890,
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
    const fakeFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });

    const { app, server } = createRealtimeServer({
      apiKey: 'test-key',
      fetchImpl: fakeFetch,
    });

    const response = await request(app).post(REALTIME_EPHEMERAL_PATH);

    expect(fakeFetch).toHaveBeenCalled();
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

  test('成功連線後會回傳狀態並轉發訊息', () => {
    const upstreamSocket = new MockSocket();
    const createUpstream = jest.fn(() => upstreamSocket);

    const handler = createRealtimeWebSocketHandler({
      apiKey: 'key',
      realtimeModel: 'test-model',
      realtimeVoice: 'verse',
      realtimeBaseUrl: 'wss://example',
      webSocketImpl: MockSocket,
      createUpstream,
    });

    const clientSocket = new MockSocket();
    clientSocket.readyState = MockSocket.OPEN;
    handler(clientSocket);

    expect(createUpstream).toHaveBeenCalledWith(
      expect.stringContaining('model=test-model'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Sec-WebSocket-Protocol': 'realtime' }),
      })
    );

    clientSocket.emit('message', 'queued-message');
    expect(upstreamSocket.sent).toHaveLength(0);

    upstreamSocket.triggerOpen();
    expect(clientSocket.sent).toContainEqual(
      expect.stringContaining('"type":"server.status"')
    );
    expect(upstreamSocket.sent).toContain('queued-message');

    upstreamSocket.readyState = MockSocket.OPEN;
    upstreamSocket.triggerMessage('server-payload');
    expect(clientSocket.sent).toContain('server-payload');

    upstreamSocket.triggerClose(4000, Buffer.from('bye'));
    expect(clientSocket.closed).toBe(true);
    const statusPayload = clientSocket.sent.find(
      (item) => item.includes('"status"') && item.includes('bye')
    );
    expect(statusPayload).toBeTruthy();
  });

  test('自訂上游工廠會收到 realtime 子通訊協定', () => {
    const upstreamSocket = new MockSocket();
    const createUpstream = jest.fn((url, protocols, config) => {
      expect(protocols).toEqual(['realtime']);
      expect(config.headers.Authorization).toBe('Bearer key');
      return upstreamSocket;
    });

    const handler = createRealtimeWebSocketHandler({
      apiKey: 'key',
      realtimeModel: 'test-model',
      realtimeVoice: 'verse',
      realtimeBaseUrl: 'wss://example',
      webSocketImpl: MockSocket,
      createUpstream,
    });

    const clientSocket = new MockSocket();
    clientSocket.readyState = MockSocket.OPEN;
    handler(clientSocket);

    expect(createUpstream).toHaveBeenCalledWith(
      expect.stringContaining('voice=verse'),
      ['realtime'],
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer key',
          'OpenAI-Beta': 'realtime=v1',
        }),
      })
    );
  });
});
