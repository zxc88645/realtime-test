import { appendMessage, recordLatency } from './context.js';
import { ensureAudioPlayer } from '../utils/audio.js';
import { extractCompletedText, extractDeltaText } from '../utils/content.js';

function resolveResponseId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  const response = event.response;
  return (
    response?.id ||
    event.response_id ||
    event.responseId ||
    (typeof event.item_id === 'string' && event.item_id.startsWith('resp_')
      ? event.item_id.replace(/^resp_/, '')
      : null)
  );
}

function extractClientMessageId(event) {
  const response = event?.response;
  const metadata =
    response?.metadata || event?.response_metadata || event?.metadata || {};
  return metadata?.client_message_id || event?.client_message_id || null;
}

function ensureResponseEntry(transport, event) {
  const responseId = resolveResponseId(event);
  if (!responseId) {
    return null;
  }

  let entry = transport.responsesById.get(responseId);
  if (!entry) {
    const clientMessageId = extractClientMessageId(event);
    const messageRole = transport.id === 'ws' ? 'gpt-ws' : 'gpt-webrtc';
    const message = appendMessage(transport, messageRole);
    entry = {
      responseId,
      clientMessageId,
      message,
    };
    transport.responsesById.set(responseId, entry);
  } else {
    entry.responseId = entry.responseId || responseId;
    if (!entry.clientMessageId) {
      const clientMessageId = extractClientMessageId(event);
      if (clientMessageId) {
        entry.clientMessageId = clientMessageId;
      }
    }
  }
  return entry;
}

function resolveConversationItemId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  return (
    event.item_id ||
    event.itemId ||
    (typeof event.item?.id === 'string' ? event.item.id : null)
  );
}

function ensureConversationItemEntry(transport, event) {
  const itemId = resolveConversationItemId(event);
  if (!itemId) {
    return null;
  }

  let entry = transport.conversationItemsById.get(itemId);
  if (!entry) {
    const message =
      transport.pendingTranscriptionMessages.length > 0
        ? transport.pendingTranscriptionMessages.shift()
        : appendMessage(transport, 'user');
    entry = { itemId, message };
    transport.conversationItemsById.set(itemId, entry);
  }

  return entry;
}

export function handleRealtimeEvent(transport, event) {
  if (!event || typeof event !== 'object') {
    return;
  }

  const appendEntryText = (entry, text) => {
    if (!entry || !text) {
      return;
    }
    entry.message.text = `${entry.message.text || ''}${text}`;
  };

  const resolveDeltaText = (currentEvent) => {
    if (!currentEvent) {
      return '';
    }
    if (typeof currentEvent.delta === 'string') {
      return currentEvent.delta;
    }
    if (
      currentEvent.delta &&
      typeof currentEvent.delta === 'object' &&
      typeof currentEvent.delta.transcript === 'string'
    ) {
      return currentEvent.delta.transcript;
    }
    if (typeof currentEvent.transcript === 'string') {
      return currentEvent.transcript;
    }
    return extractDeltaText(currentEvent);
  };

  if (event.type === 'error') {
    const message = event.error?.message || event.message || '發生未知的即時錯誤';
    appendMessage(transport, 'error', message);
    transport.status = '錯誤';
    return;
  }

  if (event.type === 'session.created') {
    transport.status = '已連線（語音就緒）';
    return;
  }

  if (event.type === 'conversation.item.input_audio_transcription.delta') {
    const entry = ensureConversationItemEntry(transport, event);
    if (entry) {
      const text = resolveDeltaText(event);
      if (text) {
        if (entry.message.text === '（語音訊息）') {
          entry.message.text = '';
        }
        entry.message.text = `${entry.message.text || ''}${text}`;
      }
    }
    return;
  }

  if (
    event.type === 'conversation.item.input_audio_transcription.completed' ||
    event.type === 'conversation.item.input_audio_transcription.done'
  ) {
    const entry = ensureConversationItemEntry(transport, event);
    if (entry) {
      const transcript = event.transcript || event.text || resolveDeltaText(event);
      if (transcript) {
        entry.message.text = transcript;
      }
    }
    const itemId = resolveConversationItemId(event);
    if (itemId) {
      transport.conversationItemsById.delete(itemId);
    }
    return;
  }

  if (event.type === 'conversation.item.completed') {
    const itemId = resolveConversationItemId(event);
    if (itemId) {
      transport.conversationItemsById.delete(itemId);
    }
  }

  if (event.type === 'response.audio.delta') {
    const audioChunk = event.delta;
    if (audioChunk) {
      try {
        const player = ensureAudioPlayer(transport);
        player.append(audioChunk).catch((error) => {
          console.warn('播放即時音訊失敗', error);
        });
      } catch (error) {
        console.warn('播放即時音訊失敗', error);
      }
    }
    return;
  }

  if (event.type === 'response.text.delta') {
    const entry = ensureResponseEntry(transport, event);
    appendEntryText(entry, resolveDeltaText(event));
    return;
  }

  if (event.type === 'response.audio_transcript.delta') {
    const entry = ensureResponseEntry(transport, event);
    appendEntryText(entry, resolveDeltaText(event));
    return;
  }

  if (event.type === 'response.output_audio_transcript.done') {
    const entry = ensureResponseEntry(transport, event);
    if (entry && event.transcript) {
      entry.message.text = event.transcript;
    }
    return;
  }

  if (event.type === 'response.output_text.delta') {
    const entry = ensureResponseEntry(transport, event);
    appendEntryText(entry, resolveDeltaText(event));
    return;
  }

  if (event.type === 'response.output_text.done') {
    const entry = ensureResponseEntry(transport, event);
    if (entry) {
      const completedText = extractCompletedText(event, entry.message.text || '');
      if (completedText) {
        entry.message.text = completedText;
      }
    }
    return;
  }

  if (event.type === 'response.done') {
    const entry = ensureResponseEntry(transport, event);
    if (entry?.clientMessageId && transport.pendingMessages.has(entry.clientMessageId)) {
      const started = transport.pendingMessages.get(entry.clientMessageId).start;
      recordLatency(transport, performance.now() - started);
      transport.pendingMessages.delete(entry.clientMessageId);
    }
    if (entry?.responseId) {
      transport.responsesById.delete(entry.responseId);
    } else {
      const responseId = resolveResponseId(event);
      if (responseId) {
        transport.responsesById.delete(responseId);
      }
    }
    if (transport.id === 'ws' && transport.connection) {
      transport.status = '已連線（語音就緒）';
    }
  }
}
