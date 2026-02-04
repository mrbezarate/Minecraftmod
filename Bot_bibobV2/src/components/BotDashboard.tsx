import React, { useEffect } from 'react';
import { useBotStore } from '../store';
import { StatusPanel, ControlPanel, InventoryPanel, LogPanel } from './Panels';

export const BotDashboard: React.FC = () => {
  const { setBotStatus, addLog } = useBotStore();

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      // Initial status check
      fetch('/api/bot/status')
        .then(async res => {
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
          const text = await res.text();
          return text ? JSON.parse(text) : { connected: false };
        })
        .then(data => setBotStatus(data))
        .catch(err => console.error('Failed to fetch initial status:', err));

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      console.log(`Attempting WS connection to ${wsUrl}`);
      
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'status_update') {
            setBotStatus(message.data);
          } else if (message.type === 'log') {
            addLog(message.data);
          }
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      ws.onopen = () => {
        console.log('Successfully connected to backend WS');
        // Request status immediately upon connection
        fetch('/api/bot/status')
          .then(res => res.json())
          .then(data => setBotStatus(data))
          .catch(() => {});
      };

      ws.onclose = () => {
        console.warn('Disconnected from backend WS, reconnecting in 2s...');
        setBotStatus({ connected: false });
        reconnectTimeout = setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        console.error('WS Error observed:', err);
      };
    };

    connect();

    return () => {
      if (ws) ws.close();
      clearTimeout(reconnectTimeout);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-white p-6 font-mono">
      <header className="mb-8 flex justify-between items-center border-b border-zinc-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-green-500">BIBOB-V2 BOT</h1>
          <p className="text-zinc-500 text-sm">Autonomous Intelligence Agent</p>
        </div>
        <ControlPanel />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <StatusPanel />
          <InventoryPanel />
        </div>
        <div className="md:col-span-1">
          <LogPanel />
        </div>
      </div>
    </div>
  );
};
