import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Socket } from 'socket.io-client';
import type { SensorData, SystemStatus, Command, CommandResult, AISuggestion } from '@shared/types';
import { endpoints } from '@services/api';
import { getFreshAccessToken } from '@services/authToken';
import { connectSocket, disconnectSocket, getSocket } from '@services/socket';

let connectionAttempt = 0;

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
  connect: (token?: string, deviceId?: string) => Promise<void>;
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
    connect: async (token, deviceId) => {
      const attempt = ++connectionAttempt;
      const { socket: existingSocket } = get();
      if (existingSocket) {
        if (existingSocket.connected) return;
      }

      set({ connecting: true, error: null });
      const resolvedToken = token ?? await getFreshAccessToken();
      if (attempt !== connectionAttempt) return;
      if (!resolvedToken) {
        set({ connected: false, connecting: false, error: 'Authentication required' });
        return;
      }

      const socket = existingSocket ?? getSocket(false);

      if (!existingSocket) {
        socket.on('connect', () => {
          set({ connected: true, connecting: false, socket, error: null });
          console.log('[Socket] Connected:', socket.id);
        });

        socket.on('disconnect', (reason) => {
          set({
            connected: false,
            connecting: reason !== 'io client disconnect',
            error: `Disconnected: ${reason}`,
          });
          console.log('[Socket] Disconnected:', reason);
        });

        socket.on('connect_error', (err) => {
          set({ connecting: false, error: err.message });
          console.error('[Socket] Connection error:', err);
        });

        socket.io.on('reconnect_attempt', () => {
          set({ connected: false, connecting: true, error: null });
        });

        socket.io.on('reconnect_failed', () => {
          set({ connected: false, connecting: false, error: 'Unable to reconnect to the backend' });
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

        // The server sends partial state snapshots after Firebase/mock updates.
        socket.on('state:update', (update: Partial<SensorState>) => {
          set((state) => ({ ...state, ...update }));
        });

        socket.on('sensor:update', (update: { sensorData?: SensorData }) => {
          if (update?.sensorData) set({ sensorData: update.sensorData });
        });

        socket.on('command:feedback', (feedback: { status?: string }) => {
          if (feedback?.status === 'failed') {
            set({ error: 'The backend could not queue the command' });
          }
        });

        // Command result acknowledgment
        socket.on('commandResult', (result: CommandResult) => {
          set(state => ({
            commandResults: { ...state.commandResults, [result.commandId]: result },
          }));
        });

        // Suggestion updates
        socket.on('suggestionUpdate', (suggestion: AISuggestion) => {
          const suggestionId = suggestion?.id;
          if (!suggestionId) return;
          set(state => ({
            aiSuggestions: { ...state.aiSuggestions, [suggestionId]: suggestion },
          }));
        });
      }

      set({ socket, connecting: true });
      if (socket.connected) {
        set({ connected: true, connecting: false, error: null });
        return;
      }
      connectSocket(resolvedToken, deviceId);
    },

    // Disconnect
    disconnect: () => {
      connectionAttempt += 1;
      disconnectSocket();
      set({ socket: null, connected: false, connecting: false, error: null });
    },

    // Send command via socket
    sendCommand: async (command) => {
      const { socket } = get();
      if (!socket?.connected) throw new Error('Not connected');

      const response = await endpoints.sendCommand(command);
      const commandId = response.data?.commandId;
      if (!response.data?.success || typeof commandId !== 'string' || !commandId) {
        throw new Error(response.data?.error || 'Command failed');
      }
      return commandId;
    },

    // Approve AI suggestion
    approveSuggestion: async (id) => {
      const { socket } = get();
      if (!socket?.connected) throw new Error('Not connected');

      const response = await endpoints.approveSuggestion(id);
      if (!response.data?.success) throw new Error(response.data?.error || 'Failed to approve');
    },

    // Reject AI suggestion
    rejectSuggestion: async (id) => {
      const { socket } = get();
      if (!socket?.connected) throw new Error('Not connected');

      const response = await endpoints.rejectSuggestion(id);
      if (!response.data?.success) throw new Error(response.data?.error || 'Failed to reject');
    },

    // Relay control
    controlRelay: async (state, reason) => {
      const { socket } = get();
      if (!socket?.connected) throw new Error('Not connected');

      const response = await endpoints.controlRelay(state, reason);
      const commandId = response.data?.commandId;
      if (!response.data?.success || typeof commandId !== 'string' || !commandId) {
        throw new Error(response.data?.error || 'Failed to control relay');
      }
      return commandId;
    },

    // Buzzer control
    controlBuzzer: async (action) => {
      const { socket } = get();
      if (!socket?.connected) throw new Error('Not connected');

      const response = await endpoints.controlBuzzer(action);
      const commandId = response.data?.commandId;
      if (!response.data?.success || typeof commandId !== 'string' || !commandId) {
        throw new Error(response.data?.error || 'Failed to control buzzer');
      }
      return commandId;
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
    _updateAISuggestion: (suggestion) => {
      const suggestionId = suggestion.id;
      if (!suggestionId) return;
      set(state => ({ aiSuggestions: { ...state.aiSuggestions, [suggestionId]: suggestion } }));
    },
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
