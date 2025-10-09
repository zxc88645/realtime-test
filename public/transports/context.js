import { reactive } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';

export function createTransportContext(id) {
  return reactive({
    id,
    status: '待命',
    latest: '–',
    average: '–',
    samples: 0,
    messages: [],
    isReady: false,
    connection: null,
    dataChannel: null,
    send: undefined,
    latencies: [],
    pendingMessages: new Map(),
    responsesById: new Map(),
    manualStop: false,
    localStream: null,
    remoteStream: null,
    audioElement: null,
    audioPlayer: null,
    mediaRecorder: null,
    microphoneStream: null,
    audioEncoder: null,
    isRecording: false,
    startRecording: undefined,
    stopRecording: undefined,
    cancelRecording: undefined,
    configureSession: undefined,
    recordedAudioBlob: null,
    recordedAudioUrl: null,
  });
}

export function resetLatencies(transport) {
  transport.latencies.length = 0;
  transport.latest = '–';
  transport.average = '–';
  transport.samples = 0;
}

export function recordLatency(transport, duration) {
  transport.latencies.push(duration);
  const average =
    transport.latencies.reduce((sum, value) => sum + value, 0) /
    transport.latencies.length;
  transport.latest = `${duration.toFixed(2)} 毫秒`;
  transport.average = `${average.toFixed(2)} 毫秒`;
  transport.samples = transport.latencies.length;
}

export function appendMessage(transport, role, text = '') {
  const message = {
    id: crypto.randomUUID(),
    role,
    text,
  };
  transport.messages.push(message);
  return message;
}
