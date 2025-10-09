import { AUDIO_SAMPLE_RATE } from '../constants.js';

export function arrayBufferToBase64(buffer) {
  if (!buffer) {
    return '';
  }
  const bytes = new Uint8Array(buffer);
  if (!bytes.byteLength) {
    return '';
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function createPcm16Encoder({ sampleRate = AUDIO_SAMPLE_RATE } = {}) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('瀏覽器不支援音訊編碼功能');
  }

  let audioContext = null;

  const ensureContext = async () => {
    if (!audioContext) {
      audioContext = new AudioContextClass({ sampleRate });
    }
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch (error) {
        console.warn('恢復 AudioContext 失敗', error);
      }
    }
    return audioContext;
  };

  const resampleToTarget = async (buffer) => {
    if (!buffer) {
      return null;
    }
    if (buffer.numberOfChannels === 1 && buffer.sampleRate === sampleRate) {
      return buffer;
    }
    const duration = buffer.duration;
    if (!duration) {
      return buffer;
    }
    const frameCount = Math.ceil(duration * sampleRate);
    const offlineContext = new OfflineAudioContext(1, frameCount, sampleRate);
    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineContext.destination);
    source.start(0);
    try {
      return await offlineContext.startRendering();
    } catch (error) {
      console.warn('重新取樣音訊時發生錯誤', error);
      return buffer;
    }
  };

  return {
    async encode(blob) {
      if (!blob || !blob.size) {
        return null;
      }
      const context = await ensureContext();
      const arrayBuffer = await blob.arrayBuffer();
      let decoded;
      try {
        decoded = await context.decodeAudioData(arrayBuffer.slice(0));
      } catch (error) {
        console.warn('解碼音訊片段時發生錯誤', error);
        return null;
      }
      if (!decoded || !decoded.length) {
        return null;
      }
      const resampled = await resampleToTarget(decoded);
      if (!resampled || !resampled.length) {
        return null;
      }
      const channelData = resampled.getChannelData(0);
      if (!channelData || !channelData.length) {
        return null;
      }
      const pcmBuffer = new ArrayBuffer(channelData.length * 2);
      const view = new DataView(pcmBuffer);
      for (let i = 0; i < channelData.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      return arrayBufferToBase64(pcmBuffer);
    },
    async close() {
      if (audioContext) {
        try {
          await audioContext.close();
        } catch (error) {
          console.warn('關閉音訊編碼器時發生錯誤', error);
        }
        audioContext = null;
      }
    },
  };
}

export function createAudioPlayer({ sampleRate = AUDIO_SAMPLE_RATE } = {}) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  let nextStartTime = 0;

  async function ensureAudioContext() {
    if (!AudioContextClass) {
      throw new Error('瀏覽器不支援即時音訊播放');
    }
    if (!audioContext) {
      audioContext = new AudioContextClass({ sampleRate });
    }
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch (error) {
        console.warn('恢復 AudioContext 失敗', error);
      }
    }
    return audioContext;
  }

  function decodeBase64ToFloat32(base64) {
    if (!base64) {
      return null;
    }
    try {
      const binary = atob(base64);
      const view = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        view[index] = binary.charCodeAt(index);
      }
      const int16Array = new Int16Array(view.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i += 1) {
        float32Array[i] = Math.max(-1, Math.min(1, int16Array[i] / 32768));
      }
      return float32Array;
    } catch (error) {
      console.warn('解碼音訊資料失敗', error);
      return null;
    }
  }

  async function append(base64) {
    const samples = decodeBase64ToFloat32(base64);
    if (!samples || !samples.length) {
      return;
    }

    let context;
    try {
      context = await ensureAudioContext();
    } catch (error) {
      console.warn('初始化音訊播放失敗', error);
      return;
    }

    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const minimumStart = context.currentTime + 0.05;
    const startTime = Math.max(nextStartTime, minimumStart);
    try {
      source.start(startTime);
    } catch (error) {
      console.warn('播放音訊片段失敗', error);
      source.disconnect();
      return;
    }
    nextStartTime = startTime + buffer.duration;
    source.addEventListener('ended', () => {
      try {
        source.disconnect();
      } catch (disconnectError) {
        console.warn('釋放音訊資源失敗', disconnectError);
      }
    });
  }

  async function reset() {
    nextStartTime = 0;
    if (audioContext) {
      try {
        await audioContext.close();
      } catch (error) {
        console.warn('關閉 AudioContext 失敗', error);
      }
      audioContext = null;
    }
  }

  return { append, reset };
}

export function ensureAudioPlayer(transport) {
  if (!transport.audioPlayer) {
    transport.audioPlayer = createAudioPlayer();
  }
  return transport.audioPlayer;
}
