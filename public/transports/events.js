import { appendMessage, recordLatency } from './context.js';
import { ensureAudioPlayer } from '../utils/audio.js';

function ensureResponseEntry(transport, event) {
  const response = event?.response;
  if (!response?.id) {
    return null;
  }
  let entry = transport.responsesById.get(response.id);
  if (!entry) {
    const clientMessageId = response.metadata?.client_message_id;
    const messageRole = transport.id === 'ws' ? 'gpt-ws' : 'gpt-webrtc';
    const message = appendMessage(transport, messageRole);
    entry = {
      clientMessageId,
      message,
    };
    transport.responsesById.set(response.id, entry);
  } else if (!entry.clientMessageId && response.metadata?.client_message_id) {
    entry.clientMessageId = response.metadata.client_message_id;
  }
  return entry;
}

export function handleRealtimeEvent(transport, event) {
  if (!event || typeof event !== 'object') {
    return;
  }

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
    if (entry && event.delta) {
      entry.message.text = `${entry.message.text || ''}${event.delta}`;
    }
    return;
  }

  if (event.type === 'response.audio_transcript.delta') {
    const entry = ensureResponseEntry(transport, event);
    if (entry && event.delta) {
      entry.message.text = `${entry.message.text || ''}${event.delta}`;
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
    if (event.response?.id) {
      transport.responsesById.delete(event.response.id);
    }
    if (transport.id === 'ws' && transport.connection) {
      transport.status = '已連線（語音就緒）';
    }
  }
}
