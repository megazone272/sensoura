import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { io, Socket } from 'socket.io-client';
import type { SensorData, SystemStatus, Command, CommandResult, AISuggestion } from '@shared/types';

interface SensorState {
  // Data
  sensorData: SensorData | null;
  system: SystemStatus | null;
  commands: Record<string, Command>;
  commandResults: Record<string, CommandResult>;
  aiSuggestions: Record<string, AISuggestion>;

  // Connection
  socket: Socket | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;

  // Actions
  connect: (token?: string, deviceId?: string) => void;
  disconnect: () => void;
  sendCommand: (command: Omit<Command, 'id' | 'timestamp'>) => Promise<string>;
  approveSuggestion: (id: string) => Promise<void>;
  rejectSuggestion: (id: string) => Promise<void>;
  controlRelay: (state: 'ON' | 'OFF', reason: string) => Promise<string>;
  controlBuzzer: (action: 'MUTE' | 'UNMUTE') => Promise<string>;

  // Internal setters (called by socket events)
  _setSensorData: (data: SensorData) => void;
  _setSystem: (data: SystemStatus) => void;
  _setCommands: (data: Record<string, Command>) => void;
  _setCommandResults: (data: Record<string, CommandResult>) => void;
  _setAISuggestions: (data: Record<string, AISuggestion>) => void;
  _setConnected: (connected: boolean) => void;
  _setConnecting: (connecting: boolean) => void;
  _setError: (error: string | null) => void;
  _updateCommandResult: (result: CommandResult) => void;
  _updateAISuggestion: (suggestion: AISuggestion) => void;
}

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

export const useSensorStore = create<SensorState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    sensorData: null,
    system: null,
    commands: {},
    commandResults: {},
    aiSuggestions: {},
    socket: null,
    connected: false,
    connecting: false,
    error: null,

    // Connect to Socket.IO
    connect: (token, deviceId) => {
      const { socket: existingSocket } = get();
      if (existingSocket?.connected) return;

      set({ connecting: true, error: null });

      const socket = io(WS_URL, {
        auth: { token, deviceId },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      });

      socket.on('connect', () => {
        set({ connected: true, connecting: false, socket, error: null });
        console.log('[Socket] Connected:', socket.id);
      });

      socket.on('disconnect', (reason) => {
        set({ connected: false, error: `Disconnected: ${reason}` });
        console.log('[Socket] Disconnected:', reason);
      });

      socket.on('connect_error', (err) => {
        set({ connecting: false, error: err.message });
        console.error('[Socket] Connection error:', err);
      });

      // Initial state
      socket.on('init', (state: Partial<SensorState>) => {
        set({
          sensorData: state.sensorData ?? null,
          system: state.system ?? null,
          commands: state.commands ?? {},
          commandResults: state.commandResults ?? {},
          aiSuggestions: state.aiSuggestions ?? {},
        });
      });

      // Real-time updates
      socket.on('sensorData', (update: { sensorData: SensorData }) => {
        set({ sensorData: update.sensorData });
      });

      socket.on('system', (update: { system: SystemStatus }) => {
        set({ system: update.system });
      });

      socket.on('commands', (update: { commands: Record<string, Command> }) => {
        set({ commands: update.commands });
      });

      socket.on('commandResults', (update: { commandResults: Record<string, CommandResult> }) => {
        set({ commandResults: update.commandResults });
      });

      socket.on('aiSuggestions', (update: { aiSuggestions: Record<string, AISuggestion> }) => {
        set({ aiSuggestions: update.aiSuggestions });
      });

      // Command result acknowledgment
      socket.on('commandResult', (result: CommandResult) => {
        set(state => ({
          commandResults: { ...state.commandResults, [result.commandId]: result },
        }));
      });

      // Suggestion updates
      socket.on('suggestionUpdate', (suggestion: AISuggestion) => {
        set(state => ({
          aiSuggestions: { ...state.aiSuggestions, [suggestion.id!]: suggestion },
        }));
      });

      set({ socket });
    },

    // Disconnect
    disconnect: () => {
      const { socket } = get();
      if (socket) {
        socket.disconnect();
        set({ socket: null, connected: false, connecting: false });
      }
    },

    // Send command via socket
    sendCommand: async (command) => {
      const { socket } = get();
      if (!socket?.connected) throw new Error('Not connected');

      return new Promise((resolve, reject) => {
        socket.emit('command', command, (response: { success: boolean; commandId?: string; error?: string }) => {
          if (response.success && response.commandId) {
            resolve(response.commandId);
          } else {
            reject(new Error(response.error || 'Command failed'));
          }
        });
      });
    },

    // Approve AI suggestion
    approveSuggestion: async (id) => {
      const { socket } = get();
      if (!socket?.connected) throw new Error('Not connected');

      return new Promise((resolve, reject) => {
        socket.emit('approveSuggestion', id, (response: { success: boolean; error?: string }) => {
          if (response.success) resolve();
          else reject(new Error(response.error || 'Failed to approve'));
        });
      });
    },

    // Reject AI suggestion
    rejectSuggestion: async (id) => {
      const { socket } = get();
      if (!socket?.connected) throw new Error('Not connected');

      return new Promise((resolve, reject) => {
        socket.emit('rejectSuggestion', id, (response: { success: boolean; error?: string }) => {
          if (response.success) resolve();
          else reject(new Error(response.error || 'Failed to reject'));
        });
      });
    },

    // Relay control
    controlRelay: async (state, reason) => {
      const { socket } = get();
      if (!socket?.connected) throw new Error('Not connected');

      return new Promise((resolve, reject) => {
        socket.emit('relayControl', { state, reason }, (response: { success: boolean; commandId?: string; error?: string }) => {
          if (response.success && response.commandId) resolve(response.commandId);
          else reject(new Error(response.error || 'Failed to control relay'));
        });
      });
    },

    // Buzzer control
    controlBuzzer: async (action) => {
      const { socket } = get();
      if (!socket?.connected) throw new Error('Not connected');

      return new Promise((resolve, reject) => {
        socket.emit('buzzerControl', { action }, (response: { success: boolean; commandId?: string; error?: string }) => {
          if (response.success && response.commandId) resolve(response.commandId);
          else reject(new Error(response.error || 'Failed to control buzzer'));
        });
      });
    },

    // Internal setters
    _setSensorData: (data) => set({ sensorData: data }),
    _setSystem: (data) => set({ system: data }),
    _setCommands: (data) => set({ commands: data }),
    _setCommandResults: (data) => set({ commandResults: data }),
    _setAISuggestions: (data) => set({ aiSuggestions: data }),
    _setConnected: (connected) => set({ connected }),
    _setConnecting: (connecting) => set({ connecting }),
    _setError: (error) => set({ error }),
    _updateCommandResult: (result) => set(state => ({
      commandResults: { ...state.commandResults, [result.commandId]: result },
    })),
    _updateAISuggestion: (suggestion) => set(state => ({
      aiSuggestions: { ...state.aiSuggestions, [suggestion.id!]: suggestion },
    })),
  }))
);

// Selectors for performance
export const useSensorData = () => useSensorStore(state => state.sensorData);
export const useSystem = () => useSensorStore(state => state.system);
export const useCommands = () => useSensorStore(state => state.commands);
export const useCommandResults = () => useSensorStore(state => state.commandResults);
export const useAISuggestions = () => useSensorStore(state => state.aiSuggestions);
export const useConnection = () => useSensorStore(state => ({
  connected: state.connected,
  connecting: state.connecting,
  error: state.error,
}));