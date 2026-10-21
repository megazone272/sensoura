import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      autoConnect: true,
    });
  }
  return socket;
}

export function connectSocket(token?: string, deviceId?: string): Socket {
  if (socket?.connected) return socket;

  socket = io(WS_URL, {
    auth: { token, deviceId },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// Socket event types
export interface SocketEvents {
  init: (state: any) => void;
  sensorData: (update: { sensorData: any }) => void;
  system: (update: { system: any }) => void;
  commands: (update: { commands: any }) => void;
  commandResults: (update: { commandResults: any }) => void;
  aiSuggestions: (update: { aiSuggestions: any }) => void;
  commandResult: (result: any) => void;
  suggestionUpdate: (suggestion: any) => void;
  telemetry: (data: any) => void;
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (err: Error) => void;
}

// Helper to subscribe to events
export function on<K extends keyof SocketEvents>(
  event: K,
  handler: SocketEvents[K]
): () => void {
  const s = getSocket();
  s.on(event, handler as any);
  return () => s.off(event, handler as any);
}

// Helper to emit events
export function emit(event: string, ...args: any[]): void {
  getSocket().emit(event, ...args);
}

// Emit with acknowledgment
export function emitWithAck<T = any>(event: string, ...args: any[]): Promise<T> {
  return new Promise((resolve) => {
    getSocket().emit(event, ...args, (response: T) => {
      resolve(response);
    });
  });
}

export default { getSocket, connectSocket, disconnectSocket, on, emit, emitWithAck };
