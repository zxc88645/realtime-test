class RealtimeSessionError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'RealtimeSessionError';
    this.status = options.status;
    this.details = options.details;
    this.cause = options.cause;
  }
}

function ensureCreateSession(factory) {
  if (typeof factory !== 'function') {
    throw new Error('OpenAI 客戶端缺少 realtime.clientSecrets.create 函式');
  }
  return factory;
}

function createRealtimeSessionService(dependencies) {
  const { createOpenAIClient, realtimeModel, realtimeVoice } = dependencies;

  if (typeof createOpenAIClient !== 'function') {
    throw new Error('必須提供 createOpenAIClient 函式');
  }

  const createSessionPayload = (session) => ({
    id: session?.id ?? null,
    client_secret: session?.client_secret ?? null,
    expires_at: session?.client_secret?.expires_at ?? null,
  });

  const resolveRealtimeClient = async () => {
    try {
      const client = await Promise.resolve(createOpenAIClient());
      const realtime = client?.realtime;
      const clientSecrets = realtime?.clientSecrets;
      const create = ensureCreateSession(clientSecrets?.create);
      return { create };
    } catch (error) {
      throw new RealtimeSessionError('建立 OpenAI 客戶端失敗', { cause: error });
    }
  };

  const createSession = async () => {
    const { create } = await resolveRealtimeClient();
    try {
      const session = await create({ model: realtimeModel, voice: realtimeVoice });
      return createSessionPayload(session);
    } catch (error) {
      if (typeof error?.status === 'number') {
        const details =
          error?.error?.message ??
          (typeof error?.message === 'string' ? error.message : undefined);
        throw new RealtimeSessionError('建立短效會話失敗', {
          status: error.status,
          details,
          cause: error,
        });
      }

      throw new RealtimeSessionError('建立短效會話時發生錯誤', {
        cause: error,
      });
    }
  };

  return { createSession };
}

module.exports = {
  createRealtimeSessionService,
  RealtimeSessionError,
};
