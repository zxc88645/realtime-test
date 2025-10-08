function createUpgradeHandler({ webSocketServer, realtimeWsPath }) {
  return (request, socket, head) => {
    let pathname;
    try {
      ({ pathname } = new URL(request.url, `http://${request.headers.host}`));
    } catch (error) {
      socket.destroy();
      return;
    }

    if (pathname === realtimeWsPath) {
      webSocketServer.handleUpgrade(request, socket, head, (socketInstance) => {
        webSocketServer.emit('connection', socketInstance, request);
      });
    } else {
      socket.destroy();
    }
  };
}

module.exports = { createUpgradeHandler };
