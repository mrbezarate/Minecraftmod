import { WebSocketServer } from 'ws';
import { Server } from 'http';

let wss: WebSocketServer | null = null;

export function initWss(server: Server) {
  wss = new WebSocketServer({ noServer: true });
  
  server.on('upgrade', (request, socket, head) => {
    const url = request.url || '';
    console.log(`Upgrade request for: ${url}`);

    if (url.startsWith('/ws')) {
      wss?.handleUpgrade(request, socket, head, (ws) => {
        wss?.emit('connection', ws, request);
      });
    } else {
      console.log(`Destroying non-WS upgrade request for: ${url}`);
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    console.log('Dashboard client connected via WebSocket');
    ws.on('close', () => console.log('Dashboard client disconnected'));
    ws.on('error', (err) => console.error('WS Client Error:', err));
    
    // Send immediate confirmation
    ws.send(JSON.stringify({ type: 'log', data: { timestamp: new Date().toLocaleTimeString(), message: 'Connected to Real-time Stream', type: 'info' } }));
  });
  wss.on('error', (err) => console.error('WSS Server Error:', err));
  return wss;
}

export function getWss() {
  return wss;
}
