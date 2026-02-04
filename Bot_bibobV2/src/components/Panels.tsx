import React, { useState } from 'react';
import { useBotStore } from '../store';
import { Heart, Utensils, MapPin, Play, Square, Package, Terminal } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

export const StatusPanel: React.FC = () => {
  const { health, hunger, position, currentTask, connected } = useBotStore();

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Terminal size={20} className="text-blue-500" />
          System Status
        </h2>
        <span className={cn(
          "px-2 py-1 rounded text-xs font-bold uppercase",
          connected ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
        )}>
          {connected ? 'Active' : 'Offline'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-zinc-500 uppercase">
            <span>Health</span>
            <span>{Math.round(health)}/20</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-red-500 transition-all duration-500" 
              style={{ width: `${(health / 20) * 100}%` }}
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-zinc-500 uppercase">
            <span>Hunger</span>
            <span>{Math.round(hunger)}/20</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-orange-500 transition-all duration-500" 
              style={{ width: `${(hunger / 20) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="flex items-center gap-2 text-zinc-400">
          <MapPin size={16} />
          <span>X: {position.x.toFixed(1)} Y: {position.y.toFixed(1)} Z: {position.z.toFixed(1)}</span>
        </div>
        <div className="flex items-center gap-2 text-zinc-400">
          <Play size={16} className="text-green-500" />
          <span>Task: <span className="text-white">{currentTask}</span></span>
        </div>
      </div>
    </div>
  );
};

export const ControlPanel: React.FC = () => {
  const { connected, reset, setBotStatus } = useBotStore();
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({
    username: 'BibobBot',
    host: 'localhost',
    port: '25565'
  });

  const toggleBot = async () => {
    setLoading(true);
    try {
      if (connected) {
        const res = await fetch('/api/bot/stop', { method: 'POST' });
        if (res.ok) {
          reset();
        } else {
          const text = await res.text();
          console.error('Stop error:', text);
        }
      } else {
        // Set connected true immediately for UX, but with a special task
        setBotStatus({ connected: true, currentTask: 'Connecting...' });
        
        const res = await fetch('/api/bot/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });
        
        if (!res.ok) {
          const text = await res.text();
          let errorMessage = 'Unknown error';
          try {
            const error = JSON.parse(text);
            errorMessage = error.error || text;
          } catch (e) {
            errorMessage = text || `HTTP ${res.status}`;
          }
          alert(`Failed to start bot: ${errorMessage}`);
          reset(); // Revert back on error
        }
      }
    } catch (e) {
      console.error(e);
      alert('Network error while managing bot');
      reset(); // Revert back on error
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center gap-4">
      {!connected && (
        <div className="flex gap-2">
          <input 
            type="text" 
            placeholder="Host"
            value={config.host}
            onChange={(e) => setConfig({...config, host: e.target.value})}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs w-32"
          />
          <input 
            type="text" 
            placeholder="Port"
            value={config.port}
            onChange={(e) => setConfig({...config, port: e.target.value})}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs w-20"
          />
        </div>
      )}
      <button
        onClick={toggleBot}
        disabled={loading}
        className={cn(
          "flex items-center gap-2 px-6 py-2 rounded-lg font-bold transition-all",
          connected 
            ? "bg-red-500 hover:bg-red-600 text-white" 
            : "bg-green-500 hover:bg-green-600 text-white",
          loading && "opacity-50 cursor-not-allowed"
        )}
      >
        {connected ? <Square size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        {connected ? 'STOP BOT' : 'START BOT'}
      </button>
    </div>
  );
};

export const InventoryPanel: React.FC = () => {
  const { inventory } = useBotStore();

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
      <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
        <Package size={20} className="text-orange-500" />
        Inventory
      </h2>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-9 gap-2">
        {Array.from({ length: 27 }).map((_, i) => {
          const item = inventory[i];
          return (
            <div key={i} className="aspect-square bg-zinc-800 border border-zinc-700 rounded flex items-center justify-center relative group">
              {item ? (
                <>
                  <div className="text-xs text-center p-1 truncate w-full">{item.name}</div>
                  <span className="absolute bottom-0 right-0 bg-black/50 px-1 text-[10px] rounded-tl">
                    {item.count}
                  </span>
                </>
              ) : (
                <div className="w-4 h-4 bg-zinc-700/50 rounded-sm" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const LogPanel: React.FC = () => {
  const { logs } = useBotStore();

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col h-[600px]">
      <div className="p-4 border-b border-zinc-800">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Terminal size={20} className="text-zinc-500" />
          Action Logs
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs">
        {logs.length === 0 && <div className="text-zinc-600 italic">No activity yet...</div>}
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-zinc-600">[{log.timestamp}]</span>
            <span className={cn(
              log.type === 'error' ? "text-red-400" : 
              log.type === 'warn' ? "text-orange-400" : "text-green-400"
            )}>
              {log.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
