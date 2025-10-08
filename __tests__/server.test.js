const request = require('supertest');
const {
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
} = require('../src/config/constants');
const { createRealtimeServer, REALTIME_EPHEMERAL_PATH } = require('../server');

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
});
