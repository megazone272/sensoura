import { io, Socket } from 'socket.io-client';
import { getFreshAccessToken } from './authToken';

const WS_URL = (import.meta.env.VITE_WS_URL ?? '').replace(/\/+$/, '');

let socket: Socket | null = null;
let pendingToken: string | null = null;
let activeDeviceId: string | undefined;
let lastRequestedToken: string | undefined;
let automaticConnectStarted = false;

export function getSocket(autoConnect = true): Socket {
  if (!socket) {
    socket = io(WS_URL, {
      auth: (callback) => {
        const oneTimeToken = pendingToken;
        pendingToken = null;
        const tokenPromise = oneTimeToken ? Promise.resolve(oneTimeToken) : getFreshAccessToken();
        void tokenPromise.then((token) => {
          callback(token ? { token, deviceId: activeDeviceId } : {});
        }).catch(() => callback({}));
      },
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      autoConnect: false,
    });
    automaticConnectStarted = false;
  }
  if (autoConnect && !socket.connected && !automaticConnectStarted) {
    automaticConnectStarted = true;
    connectSocket(undefined, activeDeviceId);
  }
  return socket;
}

export function connectSocket(token?: string, deviceId?: string): Socket {
  const targetSocket = getSocket(false);
  const tokenChanged = lastRequestedToken !== token || activeDeviceId !== deviceId;
  if (targetSocket.connected && !tokenChanged) return targetSocket;
  if (targetSocket.connected) targetSocket.disconnect();
  pendingToken = token ?? null;
  activeDeviceId = deviceId;
  lastRequestedToken = token;
  automaticConnectStarted = true;
  targetSocket.connect();
  return targetSocket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    pendingToken = null;
    activeDeviceId = undefined;
    lastRequestedToken = undefined;
    automaticConnectStarted = false;
  }
}

// Socket event types
export interface SocketEvents {
  init: (state: any) => void;
  'state:update': (state: any) => void;
  'sensor:update': (update: { sensorData: any; timestamp?: number }) => void;
  'command:feedback': (feedback: { commandId: string; status: string; timestamp: number }) => void;
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
  return new Promise((resolve, reject) => {
    getSocket().timeout(10000).emit(event, ...args, (error: Error | null, response: T) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

export default { getSocket, connectSocket, disconnectSocket, on, emit, emitWithAck };
