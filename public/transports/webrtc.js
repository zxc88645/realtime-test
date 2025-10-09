import {
  REALTIME_BASE_URL,
  REALTIME_EPHEMERAL_PATH,
  REALTIME_MODEL,
} from '../constants.js';
import { appendMessage, resetLatencies } from './context.js';
import { handleRealtimeEvent } from './events.js';
import { buildResponseCreateEvent, parseEventData } from './helpers.js';

export function stopWebRTCTransport(transport) {
  if (!transport) {
    return;
  }
  const hadConnection = !!transport.connection || !!transport.dataChannel;
  transport.manualStop = hadConnection;
  if (transport.audioElement) {
    try {
      transport.audioElement.srcObject = null;
    } catch (error) {
      console.warn('清除音訊元素來源時發生錯誤', error);
    }
  }
  if (transport.remoteStream) {
    try {
      transport.remoteStream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      console.warn('停止遠端音訊軌時發生錯誤', error);
    }
  }
  if (transport.localStream) {
    try {
      transport.localStream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      console.warn('停止本地音訊軌時發生錯誤', error);
    }
  }
  if (transport.dataChannel) {
    try {
      transport.dataChannel.close();
    } catch (error) {
      console.warn('關閉資料通道時發生錯誤', error);
    }
  }
  if (transport.connection) {
    try {
      transport.connection.close();
    } catch (error) {
      console.warn('關閉 WebRTC 連線時發生錯誤', error);
    }
  }
  transport.connection = null;
  transport.dataChannel = null;
  transport.send = undefined;
  transport.isReady = false;
  transport.pendingMessages.clear();
  transport.responsesById.clear();
  transport.localStream = null;
  transport.remoteStream = null;
  transport.status = '待命';
  if (!hadConnection) {
    transport.manualStop = false;
  }
}

function setTransceiverDirection(transceiver, direction) {
  if (!transceiver) {
    return;
  }
  if (typeof transceiver.setDirection === 'function') {
    try {
      transceiver.setDirection(direction);
      return;
    } catch (error) {
      console.warn('設定傳輸方向時發生錯誤', error);
    }
  }
  try {
    transceiver.direction = direction;
  } catch (error) {
    console.warn('無法直接設定傳輸方向', error);
  }
}

export async function startWebRTCTransport(transport, resolveLanguage) {
  if (transport.connection) {
    try {
      transport.connection.close();
    } catch (error) {
      console.warn('關閉既有 WebRTC 連線時發生錯誤', error);
    }
  }
  transport.connection = null;
  transport.dataChannel = null;
  transport.send = undefined;
  transport.isReady = false;
  transport.pendingMessages.clear();
  transport.responsesById.clear();
  resetLatencies(transport);
  transport.status = '取得金鑰中…';

  let token;
  try {
    const response = await fetch(REALTIME_EPHEMERAL_PATH, {
      method: 'POST',
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`取得短效金鑰失敗（${response.status}）：${errorText}`);
    }
    const data = await response.json();
    token = data?.client_secret?.value || data?.client_secret;
    if (!token) {
      throw new Error('短效金鑰回應缺少 client secret');
    }
  } catch (error) {
    console.error('取得短效金鑰失敗', error);
    appendMessage(transport, 'error', error.message || '取得短效金鑰失敗');
    transport.status = '錯誤（金鑰）';
    return;
  }

  const peerConnection = new RTCPeerConnection();
  transport.connection = peerConnection;

  const dataChannel = peerConnection.createDataChannel('oai-events');
  transport.dataChannel = dataChannel;

  transport.remoteStream = new MediaStream();
  if (!transport.audioElement) {
    const audioElement = document.createElement('audio');
    audioElement.autoplay = true;
    audioElement.playsInline = true;
    audioElement.controls = false;
    audioElement.hidden = true;
    document.body.appendChild(audioElement);
    transport.audioElement = audioElement;
  }
  if (transport.audioElement) {
    transport.audioElement.srcObject = transport.remoteStream;
  }

  const audioTransceiver = peerConnection.addTransceiver('audio', {
    direction: 'sendrecv',
  });

  let localStream = null;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    transport.localStream = localStream;
    const [track] = localStream.getAudioTracks();
    if (track) {
      await audioTransceiver.sender.replaceTrack(track);
      setTransceiverDirection(audioTransceiver, 'sendrecv');
    } else {
      setTransceiverDirection(audioTransceiver, 'recvonly');
    }
  } catch (error) {
    console.warn('取得麥克風音訊失敗，將以僅接收模式繼續', error);
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    transport.localStream = null;
    setTransceiverDirection(audioTransceiver, 'recvonly');
  }

  peerConnection.addEventListener('track', (event) => {
    if (!transport.remoteStream) {
      return;
    }
    transport.remoteStream.addTrack(event.track);
    if (transport.audioElement) {
      const playPromise = transport.audioElement.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    }
  });

  dataChannel.addEventListener('open', () => {
    transport.isReady = true;
    transport.status = '已連線';
  });

  dataChannel.addEventListener('message', async (event) => {
    try {
      const payload = await parseEventData(event.data);
      handleRealtimeEvent(transport, payload);
    } catch (error) {
      console.error('解析資料通道負載時發生錯誤', error);
    }
  });

  dataChannel.addEventListener('close', () => {
    transport.isReady = false;
    transport.dataChannel = null;
    transport.connection = null;
    transport.send = undefined;
    transport.pendingMessages.clear();
    transport.responsesById.clear();
    transport.status = transport.manualStop ? '待命' : '已關閉';
    transport.manualStop = false;
    try {
      peerConnection.close();
    } catch (error) {
      console.warn('關閉對等連線時發生錯誤', error);
    }
  });

  dataChannel.addEventListener('error', (error) => {
    console.error('資料通道發生錯誤', error);
    transport.status = '錯誤（詳見主控台）';
  });

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await new Promise((resolve) => {
      if (peerConnection.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const checkState = () => {
        if (peerConnection.iceGatheringState === 'complete') {
          peerConnection.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      peerConnection.addEventListener('icegatheringstatechange', checkState);
      setTimeout(() => {
        peerConnection.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, 2000);
    });

    debugger;
    const offerSdp = peerConnection.localDescription?.sdp;
    if (!offerSdp) {
      throw new Error('缺少本地 SDP offer');
    }

    transport.status = '協商中…';

    const answerResponse = await fetch(
      `${REALTIME_BASE_URL}/calls`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/sdp',
        },
        body: offerSdp,
      }
    );

    if (!answerResponse.ok) {
      const errorText = await answerResponse.text();
      throw new Error(`OpenAI WebRTC 協商失敗（${answerResponse.status}）：${errorText}`);
    }

    const answerSdp = await answerResponse.text();
    await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    transport.status = '等待資料通道…';
  } catch (error) {
    console.error('WebRTC 協商失敗', error);
    appendMessage(transport, 'error', error.message || 'WebRTC 協商失敗');
    transport.status = '錯誤（詳見主控台）';
    try {
      peerConnection.close();
    } catch (closeError) {
      console.warn('關閉失敗的對等連線時發生錯誤', closeError);
    }
    transport.connection = null;
    transport.dataChannel = null;
    transport.send = undefined;
    transport.pendingMessages.clear();
    transport.responsesById.clear();
    transport.manualStop = false;
    return;
  }

  transport.send = (text) => {
    const channel = transport.dataChannel;
    if (!channel || channel.readyState !== 'open') {
      return false;
    }
    const message = text.trim();
    if (!message) {
      return false;
    }
    const clientMessageId = crypto.randomUUID();
    const language = typeof resolveLanguage === 'function' ? resolveLanguage() : null;
    channel.send(
      JSON.stringify(
        buildResponseCreateEvent(message, clientMessageId, {
          language,
        })
      )
    );
    transport.pendingMessages.set(clientMessageId, {
      start: performance.now(),
    });
    appendMessage(transport, 'user', message);
    return true;
  };
}
