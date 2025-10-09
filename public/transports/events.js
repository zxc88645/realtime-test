import { appendMessage, recordLatency } from './context.js';
import { ensureAudioPlayer } from '../utils/audio.js';
import { extractCompletedText, extractDeltaText } from '../utils/content.js';

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
    if (event.response?.id) {
      transport.responsesById.delete(event.response.id);
    }
    if (transport.id === 'ws' && transport.connection) {
      transport.status = '已連線（語音就緒）';
    }
  }
}
