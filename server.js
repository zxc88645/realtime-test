const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { RTCPeerConnection } = require('wrtc');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

const webSocketServer = new WebSocketServer({ noServer: true });

webSocketServer.on('connection', (socket) => {
  console.log('WebSocket client connected');
  socket.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'ping') {
        socket.send(
          JSON.stringify({
            type: 'pong',
            id: data.id,
            clientSentTs: data.clientSentTs,
            serverReceivedTs: Date.now(),
          })
        );
      }
    } catch (error) {
      console.error('Invalid message received on WebSocket', error);
    }
  });

  socket.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    webSocketServer.handleUpgrade(request, socket, head, (socket) => {
      webSocketServer.emit('connection', socket, request);
    });
  } else {
    socket.destroy();
  }
});

const activePeerConnections = new Set();

function cleanupPeerConnection(peerConnection) {
  try {
    peerConnection.close();
  } catch (error) {
    console.warn('Error closing peer connection', error);
  }
  activePeerConnections.delete(peerConnection);
}

app.post('/webrtc-offer', async (req, res) => {
  const offer = req.body;
  if (!offer || !offer.sdp || !offer.type) {
    res.status(400).json({ error: 'Invalid SDP offer' });
    return;
  }

  const peerConnection = new RTCPeerConnection();
  activePeerConnections.add(peerConnection);

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log('Peer connection state changed:', state);
    if (['disconnected', 'failed', 'closed'].includes(state)) {
      cleanupPeerConnection(peerConnection);
    }
  };

  peerConnection.ondatachannel = (event) => {
    const channel = event.channel;
    channel.onmessage = (messageEvent) => {
      try {
        const data = JSON.parse(messageEvent.data);
        if (data.type === 'ping') {
          channel.send(
            JSON.stringify({
              type: 'pong',
              id: data.id,
              clientSentTs: data.clientSentTs,
              serverReceivedTs: Date.now(),
            })
          );
        }
      } catch (error) {
        console.error('Invalid message received on data channel', error);
      }
    };

    channel.onclose = () => {
      console.log('Data channel closed');
      cleanupPeerConnection(peerConnection);
    };
  };

  try {
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

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

    res.json(peerConnection.localDescription);
  } catch (error) {
    console.error('Failed to handle WebRTC offer', error);
    cleanupPeerConnection(peerConnection);
    res.status(500).json({ error: 'Failed to process WebRTC offer' });
  }
});

process.on('SIGINT', () => {
  console.log('Shutting down, closing peer connections');
  activePeerConnections.forEach((peerConnection) => {
    cleanupPeerConnection(peerConnection);
  });
  server.close(() => process.exit(0));
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
