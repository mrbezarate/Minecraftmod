import { create } from 'zustand';

interface BotState {
  connected: boolean;
  health: number;
  hunger: number;
  position: { x: number; y: number; z: number };
  currentTask: string;
  inventory: Array<{ name: string; count: number }>;
  logs: Array<{ timestamp: string; message: string; type: 'info' | 'warn' | 'error' }>;
  setBotStatus: (status: any) => void;
  addLog: (log: any) => void;
  reset: () => void;
}

export const useBotStore = create<BotState>((set) => ({
  connected: false,
  health: 20,
  hunger: 20,
  position: { x: 0, y: 0, z: 0 },
  currentTask: 'idle',
  inventory: [],
  logs: [],
  setBotStatus: (status) => set((state) => ({ ...state, ...status })),
  addLog: (log) => set((state) => ({ logs: [log, ...state.logs].slice(0, 100) })),
  reset: () => set({ 
    connected: false, 
    health: 20, 
    hunger: 20, 
    position: { x: 0, y: 0, z: 0 },
    inventory: [], 
    currentTask: 'idle' 
  }),
}));
