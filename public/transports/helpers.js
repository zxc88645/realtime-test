export async function parseEventData(data) {
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

export function buildResponseCreateEvent(text, clientMessageId) {
  const input = [
    {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text,
        },
      ],
    },
  ];

  const response = {
    metadata: {
      client_message_id: clientMessageId,
    },
    input,
  };

  return {
    type: 'response.create',
    response,
  };
}

export function buildAudioResponseCreateEvent(clientMessageId) {
  return {
    type: 'response.create',
    response: {
      metadata: {
        client_message_id: clientMessageId,
      },
      input: [],
    },
  };
}
