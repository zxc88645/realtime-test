const REFRESH_INTERVAL_MS = 1000;

function createLatencyTracker(root) {
  const statusEl = root.querySelector('.status');
  const latestEl = root.querySelector('.latest');
  const averageEl = root.querySelector('.average');
  const samplesEl = root.querySelector('.samples');

  const latencies = [];

  return {
    setStatus(status) {
      statusEl.textContent = status;
    },
    recordLatency(duration) {
      latencies.push(duration);
      const average =
        latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
      latestEl.textContent = `${duration.toFixed(2)} ms`;
      averageEl.textContent = `${average.toFixed(2)} ms`;
      samplesEl.textContent = String(latencies.length);
    },
    reset() {
      latencies.length = 0;
      latestEl.textContent = '–';
      averageEl.textContent = '–';
      samplesEl.textContent = '0';
    },
  };
}

async function startWebSocketTest(tracker) {
  tracker.reset();
  tracker.setStatus('Connecting…');

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  const inflight = new Map();

  ws.addEventListener('open', () => {
    tracker.setStatus('Connected');
    const interval = setInterval(() => {
      const id = crypto.randomUUID();
      const clientSentTs = performance.now();
      inflight.set(id, clientSentTs);
      ws.send(
        JSON.stringify({
          type: 'ping',
          id,
          clientSentTs,
        })
      );
    }, REFRESH_INTERVAL_MS);

    ws.addEventListener('close', () => {
      clearInterval(interval);
      tracker.setStatus('Closed');
    });
  });

  ws.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'pong' && payload.id && inflight.has(payload.id)) {
        const start = inflight.get(payload.id);
        inflight.delete(payload.id);
        tracker.recordLatency(performance.now() - start);
      }
    } catch (error) {
      console.error('WebSocket message parse error', error);
    }
  });

  ws.addEventListener('error', (error) => {
    console.error('WebSocket error', error);
    tracker.setStatus('Error (see console)');
  });
}

async function startWebRTCTest(tracker) {
  tracker.reset();
  tracker.setStatus('Connecting…');

  const peerConnection = new RTCPeerConnection();
  const dataChannel = peerConnection.createDataChannel('latency');

  const inflight = new Map();

  dataChannel.addEventListener('open', () => {
    tracker.setStatus('Connected');
    const interval = setInterval(() => {
      if (dataChannel.readyState !== 'open') {
        clearInterval(interval);
        return;
      }
      const id = crypto.randomUUID();
      const clientSentTs = performance.now();
      inflight.set(id, clientSentTs);
      dataChannel.send(
        JSON.stringify({
          type: 'ping',
          id,
          clientSentTs,
        })
      );
    }, REFRESH_INTERVAL_MS);

    dataChannel.addEventListener('close', () => {
      clearInterval(interval);
      tracker.setStatus('Closed');
    });
  });

  dataChannel.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'pong' && payload.id && inflight.has(payload.id)) {
        const start = inflight.get(payload.id);
        inflight.delete(payload.id);
        tracker.recordLatency(performance.now() - start);
      }
    } catch (error) {
      console.error('Data channel message parse error', error);
    }
  });

  dataChannel.addEventListener('error', (error) => {
    console.error('Data channel error', error);
    tracker.setStatus('Error (see console)');
  });

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const response = await fetch('/webrtc-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(peerConnection.localDescription),
    });

    if (!response.ok) {
      throw new Error(`Failed to negotiate: ${response.status}`);
    }

    const answer = await response.json();
    await peerConnection.setRemoteDescription(answer);
    tracker.setStatus('Waiting for channel…');
  } catch (error) {
    console.error('WebRTC setup error', error);
    tracker.setStatus('Error (see console)');
  }
}

const startButton = document.querySelector('#start');
const wsTracker = createLatencyTracker(document.querySelector('#ws-result'));
const webrtcTracker = createLatencyTracker(
  document.querySelector('#webrtc-result')
);

startButton.addEventListener('click', () => {
  startWebSocketTest(wsTracker);
  startWebRTCTest(webrtcTracker);
  startButton.disabled = true;
  startButton.textContent = 'Testing…';
});
