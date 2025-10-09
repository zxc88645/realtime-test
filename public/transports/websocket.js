import { AUDIO_SAMPLE_RATE, REALTIME_VOICE, REALTIME_WS_PATH } from '../constants.js';
import { createPcm16Encoder } from '../utils/audio.js';
import { appendMessage, resetLatencies } from './context.js';
import { handleRealtimeEvent } from './events.js';
import {
  buildAudioResponseCreateEvent,
  buildResponseCreateEvent,
  parseEventData,
} from './helpers.js';

export function stopWebSocketTransport(transport) {
  if (!transport) {
    return;
  }
  const hadConnection = !!transport.connection;
  transport.manualStop = hadConnection;
  if (typeof transport.cancelRecording === 'function') {
    try {
      transport.cancelRecording({ silent: true });
    } catch (error) {
      console.warn('取消語音錄製時發生錯誤', error);
    }
  }
  if (hadConnection) {
    try {
      transport.connection.close();
    } catch (error) {
      console.warn('關閉 WebSocket 連線時發生錯誤', error);
    }
  }
  transport.connection = null;
  transport.send = undefined;
  transport.isReady = false;
  transport.pendingMessages.clear();
  transport.responsesById.clear();
  if (transport.audioPlayer) {
    transport.audioPlayer.reset().catch((error) => {
      console.warn('重設即時音訊播放器失敗', error);
    });
  }
  if (transport.microphoneStream) {
    try {
      transport.microphoneStream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      console.warn('停止麥克風串流時發生錯誤', error);
    }
  }
  transport.mediaRecorder = null;
  transport.microphoneStream = null;
  transport.isRecording = false;
  if (transport.audioEncoder?.close) {
    Promise.resolve(transport.audioEncoder.close()).catch((error) => {
      console.warn('關閉音訊編碼器時發生錯誤', error);
    });
  }
  transport.audioEncoder = null;
  transport.startRecording = undefined;
  transport.stopRecording = undefined;
  transport.cancelRecording = undefined;
  transport.configureSession = undefined;
  if (transport.recordedAudioUrl) {
    URL.revokeObjectURL(transport.recordedAudioUrl);
    transport.recordedAudioUrl = null;
  }
  transport.recordedAudioBlob = null;
  transport.status = '待命';
  if (!hadConnection) {
    transport.manualStop = false;
  }
}

export function startWebSocketTransport(transport) {
  if (transport.connection) {
    try {
      transport.connection.close();
    } catch (error) {
      console.warn('關閉既有 WebSocket 連線時發生錯誤', error);
    }
  }
  if (typeof transport.cancelRecording === 'function') {
    try {
      transport.cancelRecording({ silent: true });
    } catch (error) {
      console.warn('取消既有語音錄製時發生錯誤', error);
    }
  }
  if (transport.audioEncoder?.close) {
    Promise.resolve(transport.audioEncoder.close()).catch((error) => {
      console.warn('關閉音訊編碼器時發生錯誤', error);
    });
  }
  transport.audioEncoder = null;
  transport.connection = null;
  transport.send = undefined;
  transport.isReady = false;
  transport.pendingMessages.clear();
  transport.responsesById.clear();
  transport.startRecording = undefined;
  transport.stopRecording = undefined;
  transport.cancelRecording = undefined;
  transport.configureSession = undefined;
  transport.mediaRecorder = null;
  transport.microphoneStream = null;
  transport.isRecording = false;
  if (transport.audioPlayer) {
    transport.audioPlayer.reset().catch((error) => {
      console.warn('重設即時音訊播放器失敗', error);
    });
  }
  resetLatencies(transport);
  transport.status = '連線中…';

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}${REALTIME_WS_PATH}`);
  transport.connection = socket;

  const queue = [];

  const sendEvent = (event) => {
    const payload = JSON.stringify(event);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
      return true;
    }
    if (socket.readyState === WebSocket.CONNECTING) {
      queue.push(payload);
      return true;
    }
    return false;
  };

  let encoder = null;
  let recorder = null;
  let microphoneStream = null;
  let encodingQueue = Promise.resolve();
  let shouldSubmitRecording = true;
  let silentCancel = false;
  let hasAudioData = false;
  let pendingStopResolver = null;
  let encodingFailed = false;
  let recordedChunks = [];

  const ensureEncoder = async () => {
    if (!encoder) {
      encoder = createPcm16Encoder({ sampleRate: AUDIO_SAMPLE_RATE });
      transport.audioEncoder = encoder;
    }
    return encoder;
  };

  const releaseEncoder = async () => {
    if (encoder?.close) {
      try {
        await encoder.close();
      } catch (error) {
        console.warn('關閉音訊編碼器時發生錯誤', error);
      }
    }
    encoder = null;
    transport.audioEncoder = null;
  };

  const stopTracks = (stream) => {
    if (!stream) {
      return;
    }
    try {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn('停止音訊軌時發生錯誤', error);
        }
      });
    } catch (error) {
      console.warn('釋放音訊串流時發生錯誤', error);
    }
  };

  const resetRecordingState = () => {
    stopTracks(microphoneStream);
    microphoneStream = null;
    transport.microphoneStream = null;
    recorder = null;
    transport.mediaRecorder = null;
    transport.isRecording = false;
    shouldSubmitRecording = true;
    silentCancel = false;
    hasAudioData = false;
    encodingFailed = false;
    pendingStopResolver = null;
    encodingQueue = Promise.resolve();
    recordedChunks = [];
  };

  const finalizeRecording = async () => {
    transport.isRecording = false;
    await encodingQueue.catch(() => {});
    encodingQueue = Promise.resolve();

    if (recordedChunks.length > 0) {
      const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
      transport.recordedAudioBlob = audioBlob;
      if (transport.recordedAudioUrl) {
        URL.revokeObjectURL(transport.recordedAudioUrl);
      }
      transport.recordedAudioUrl = URL.createObjectURL(audioBlob);
    }

    if (!shouldSubmitRecording || !hasAudioData) {
      if (hasAudioData) {
        sendEvent({ type: 'input_audio_buffer.clear' });
      }
      if (!silentCancel) {
        if (encodingFailed) {
          transport.status = '已連線（語音就緒）';
        } else if (!shouldSubmitRecording) {
          transport.status = '已連線（語音就緒）';
        } else if (!hasAudioData) {
          appendMessage(transport, 'error', '本次語音訊息沒有偵測到聲音，已取消送出。');
          transport.status = '已連線（語音就緒）';
        }
      }
      resetRecordingState();
      return;
    }

    transport.status = '等待語音回覆…';
    sendEvent({ type: 'input_audio_buffer.commit' });
    const clientMessageId = crypto.randomUUID();
    const responseEvent = buildAudioResponseCreateEvent(clientMessageId);
    sendEvent(responseEvent);
    transport.pendingMessages.set(clientMessageId, {
      start: performance.now(),
    });
    appendMessage(transport, 'user', '（語音訊息）');
    resetRecordingState();
  };

  const configureSession = () => {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: '你是一位即時語音助理，會以語音與文字同步回覆使用者。',
      },
    };
    if (REALTIME_VOICE) {
      sessionUpdate.session.voice = REALTIME_VOICE;
    }
    sendEvent(sessionUpdate);
  };

  const startRecording = async () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendMessage(transport, 'error', 'WebSocket 尚未連線，無法開始錄音。');
      return false;
    }
    if (transport.isRecording) {
      return true;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      appendMessage(transport, 'error', '瀏覽器不支援麥克風擷取功能。');
      return false;
    }

    transport.status = '等待麥克風權限…';
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: AUDIO_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      console.error('取得麥克風權限失敗', error);
      appendMessage(transport, 'error', '無法取得麥克風權限，請確認瀏覽器設定。');
      transport.status = '已連線（語音就緒）';
      return false;
    }

    transport.microphoneStream = microphoneStream;

    try {
      recorder = new MediaRecorder(microphoneStream, { mimeType: 'audio/webm' });
    } catch (error) {
      console.error('建立 MediaRecorder 失敗', error);
      appendMessage(transport, 'error', '瀏覽器不支援目前的錄音設定。');
      transport.status = '已連線（語音就緒）';
      stopTracks(microphoneStream);
      microphoneStream = null;
      transport.microphoneStream = null;
      return false;
    }

    encodingQueue = Promise.resolve();
    shouldSubmitRecording = true;
    silentCancel = false;
    hasAudioData = false;
    encodingFailed = false;
    transport.mediaRecorder = recorder;
    transport.isRecording = true;

    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data || !event.data.size) {
        return;
      }
      recordedChunks.push(event.data);

      encodingQueue = encodingQueue
        .then(async () => {
          const encoderInstance = await ensureEncoder();
          const base64 = await encoderInstance.encode(event.data);
          if (base64) {
            hasAudioData = true;
            sendEvent({ type: 'input_audio_buffer.append', audio: base64 });
          }
        })
        .catch((error) => {
          console.error('處理音訊片段時發生錯誤', error);
          if (!encodingFailed && !silentCancel) {
            appendMessage(transport, 'error', '編碼音訊片段失敗，已取消此次語音訊息。');
          }
          encodingFailed = true;
          shouldSubmitRecording = false;
          if (recorder && recorder.state !== 'inactive') {
            try {
              recorder.stop();
            } catch (stopError) {
              console.warn('停止錄音時發生錯誤', stopError);
            }
          }
        });
    });

    recorder.addEventListener('error', (event) => {
      console.error('MediaRecorder 錄音失敗', event.error || event);
      if (!encodingFailed && !silentCancel) {
        appendMessage(transport, 'error', '錄音發生錯誤，已取消此次語音訊息。');
      }
      encodingFailed = true;
      shouldSubmitRecording = false;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (stopError) {
          console.warn('停止錄音時發生錯誤', stopError);
        }
      }
    });

    const handleRecorderStop = () => {
      const finalize = finalizeRecording().catch((error) => {
        console.error('處理語音錄製結果時發生錯誤', error);
      });
      const resolver = pendingStopResolver;
      pendingStopResolver = null;
      if (resolver) {
        finalize.finally(resolver);
      }
    };

    recorder.addEventListener('stop', handleRecorderStop, { once: true });

    try {
      recorder.start(250);
    } catch (error) {
      console.error('啟動語音錄製失敗', error);
      appendMessage(transport, 'error', '啟動語音錄製失敗，請稍後再試。');
      transport.status = '已連線（語音就緒）';
      resetRecordingState();
      return false;
    }

    transport.status = '錄音中…';
    return true;
  };

  const stopRecording = async ({ shouldSubmit = true, silent = false } = {}) => {
    shouldSubmitRecording = shouldSubmit;
    silentCancel = silent;
    if (!recorder) {
      if (!silent) {
        transport.status = '已連線（語音就緒）';
      }
      return Promise.resolve();
    }
    if (recorder.state !== 'inactive') {
      return new Promise((resolve) => {
        pendingStopResolver = resolve;
        try {
          recorder.stop();
        } catch (error) {
          console.warn('停止錄音時發生錯誤', error);
          pendingStopResolver = null;
          resolve();
        }
      });
    }
    await finalizeRecording();
    return Promise.resolve();
  };

  transport.startRecording = startRecording;
  transport.stopRecording = () => stopRecording({ shouldSubmit: true });
  transport.cancelRecording = (options = {}) =>
    stopRecording({ shouldSubmit: false, silent: options?.silent ?? false });
  transport.configureSession = configureSession;

  socket.addEventListener('open', () => {
    transport.isReady = true;
    transport.status = '已連線（語音就緒）';
    while (queue.length && socket.readyState === WebSocket.OPEN) {
      socket.send(queue.shift());
    }
    configureSession();
  });

  socket.addEventListener('message', async (event) => {
    try {
      const payload = await parseEventData(event.data);
      handleRealtimeEvent(transport, payload);
    } catch (error) {
      console.error('解析 WebSocket 負載時發生錯誤', error);
    }
  });

  socket.addEventListener('close', () => {
    transport.isReady = false;
    stopRecording({ shouldSubmit: false, silent: true }).catch(() => {});
    releaseEncoder();
    transport.connection = null;
    transport.send = undefined;
    transport.pendingMessages.clear();
    transport.responsesById.clear();
    if (transport.audioPlayer) {
      transport.audioPlayer.reset().catch((error) => {
        console.warn('重設即時音訊播放器失敗', error);
      });
    }
    transport.startRecording = undefined;
    transport.stopRecording = undefined;
    transport.cancelRecording = undefined;
    transport.configureSession = undefined;
    transport.mediaRecorder = null;
    transport.microphoneStream = null;
    transport.isRecording = false;
    transport.status = transport.manualStop ? '待命' : '已關閉';
    transport.manualStop = false;
  });

  socket.addEventListener('error', (error) => {
    console.error('WebSocket 傳輸發生錯誤', error);
    transport.status = '錯誤（詳見主控台）';
  });

  transport.send = (text) => {
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      return false;
    }
    const message = text.trim();
    if (!message) {
      return false;
    }
    const clientMessageId = crypto.randomUUID();
    const event = buildResponseCreateEvent(message, clientMessageId);
    if (!sendEvent(event)) {
      return false;
    }
    transport.pendingMessages.set(clientMessageId, {
      start: performance.now(),
    });
    appendMessage(transport, 'user', message);
    transport.status = '等待語音回覆…';
    return true;
  };
}
