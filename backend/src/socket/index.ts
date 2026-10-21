import { getLogger } from '../utils/logger.js';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { z } from 'zod';
import { realtimeService } from '../services/realtime.js';
import type { Command } from '../models/sensoura.js';

// Same validation the HTTP /api/command route applies — the socket path must
// not be a weaker entry point for unvalidated commands.
const socketCommandSchema = z.object({
  target: z.enum(['pump', 'buzzer', 'led', 'system']),
  action: z.enum(['ON', 'OFF', 'MUTE', 'UNMUTE', 'REBOOT', 'CALIBRATE']),
  mode: z.enum(['MANUAL', 'AUTO']).default('MANUAL'),
});

const logger = getLogger('socket');

interface AuthenticatedSocket extends Socket {
  userId?: string;
  role?: 'admin' | 'operator' | 'viewer' | 'device';
  deviceId?: string;
}

const connectedClients = new Map<string, AuthenticatedSocket>();

export function initializeSocketIO(httpServer: HttpServer, frontendUrl: string): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 10000,
    pingTimeout: 5000,
  });

  // Authentication middleware
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    const deviceId = socket.handshake.auth.deviceId || socket.handshake.query.deviceId;

    if (deviceId) {
      // ESP32 device authentication
      socket.deviceId = deviceId as string;
      socket.role = 'device';
      socket.userId = `device-${deviceId}`;
      logger.info({ deviceId }, 'ESP32 device connected');
      return next();
    }

    if (token) {
      // JWT validation would go here
      // For now, accept any token in dev
      socket.userId = `user-${Date.now()}`;
      socket.role = 'operator';
      return next();
    }

    // Anonymous dashboard connection: default to 'operator' so the Command
    // Center works without a login system (competition-internal deployment).
    // Clients may explicitly request read-only access via auth.role='viewer'.
    const requestedRole = (socket.handshake.auth.role ?? socket.handshake.query.role) as string | undefined;
    socket.userId = `user-${Date.now()}`;
    socket.role = requestedRole === 'viewer' ? 'viewer' : 'operator';
    next();
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    connectedClients.set(socket.id, socket);
    logger.info({ socketId: socket.id, role: socket.role, userId: socket.userId }, 'Client connected');

    // Send initial state
    const state = realtimeService.getState();
    socket.emit('init', state);

    // Subscribe to real-time updates
    const unsubscribers: (() => void)[] = [];

    const subscribeTo = (key: string) => {
      const unsub = realtimeService.subscribe(key, (update) => {
        socket.emit(key, update);
      });
      unsubscribers.push(unsub);
    };

    subscribeTo('sensorData');
    subscribeTo('system');
    subscribeTo('commands');
    subscribeTo('commandResults');
    subscribeTo('aiSuggestions');

    // Command handling
    socket.on('command', async (command: Pick<Command, 'target' | 'action' | 'mode'>, ack) => {
      try {
        if (socket.role === 'viewer') {
          ack?.({ success: false, error: 'Viewers cannot send commands' });
          return;
        }
        const parsed = socketCommandSchema.safeParse(command);
        if (!parsed.success) {
          ack?.({ success: false, error: 'Invalid command', details: parsed.error.flatten() });
          return;
        }
        const commandId = await realtimeService.sendCommand(parsed.data);
        ack?.({ success: true, commandId });
        logger.info({ socketId: socket.id, commandId, ...parsed.data }, 'Command executed via socket');
      } catch (error) {
        ack?.({ success: false, error: (error as Error).message });
      }
    });

    // Suggestion approval
    socket.on('approveSuggestion', async (suggestionId: string, ack) => {
      try {
        if (socket.role === 'viewer') {
          ack?.({ success: false, error: 'Viewers cannot approve suggestions' });
          return;
        }
        await realtimeService.approveSuggestion(suggestionId);
        ack?.({ success: true });
        logger.info({ socketId: socket.id, suggestionId }, 'Suggestion approved');
      } catch (error) {
        ack?.({ success: false, error: (error as Error).message });
      }
    });

    socket.on('rejectSuggestion', async (suggestionId: string, ack) => {
      try {
        if (socket.role === 'viewer') {
          ack?.({ success: false, error: 'Viewers cannot reject suggestions' });
          return;
        }
        await realtimeService.rejectSuggestion(suggestionId);
        ack?.({ success: true });
        logger.info({ socketId: socket.id, suggestionId }, 'Suggestion rejected');
      } catch (error) {
        ack?.({ success: false, error: (error as Error).message });
      }
    });

    // Device telemetry ingestion (from ESP32)
    socket.on('telemetry', (data: any, ack) => {
      if (socket.role !== 'device') {
        ack?.({ success: false, error: 'Only devices can send telemetry' });
        return;
      }
      // Process and validate telemetry
      realtimeService.emit('telemetry', { deviceId: socket.deviceId, data, timestamp: Date.now() });
      ack?.({ success: true });
    });

    // Manual relay control
    socket.on('relayControl', async (data: { state: 'ON' | 'OFF'; reason: string }, ack) => {
      try {
        if (socket.role === 'viewer') {
          ack?.({ success: false, error: 'Viewers cannot control relay' });
          return;
        }
        if (!data || !['ON', 'OFF'].includes(data.state)) {
          ack?.({ success: false, error: 'Invalid relay state' });
          return;
        }
        const commandId = await realtimeService.sendCommand({
          target: 'pump',
          action: data.state,
          mode: 'MANUAL',
        });
        ack?.({ success: true, commandId });
      } catch (error) {
        ack?.({ success: false, error: (error as Error).message });
      }
    });

    // Buzzer control
    socket.on('buzzerControl', async (data: { action: 'MUTE' | 'UNMUTE' }, ack) => {
      try {
        if (socket.role === 'viewer') {
          ack?.({ success: false, error: 'Viewers cannot control buzzer' });
          return;
        }
        if (!data || !['MUTE', 'UNMUTE'].includes(data.action)) {
          ack?.({ success: false, error: 'Invalid buzzer action' });
          return;
        }
        const commandId = await realtimeService.sendCommand({
          target: 'buzzer',
          action: data.action,
          mode: 'MANUAL',
        });
        ack?.({ success: true, commandId });
      } catch (error) {
        ack?.({ success: false, error: (error as Error).message });
      }
    });

    // Subscribe/unsubscribe to specific data streams
    socket.on('subscribe', (streams: string[]) => {
      streams.forEach(stream => {
        if (!['sensorData', 'system', 'commands', 'commandResults', 'aiSuggestions', 'telemetry'].includes(stream)) return;
        const unsub = realtimeService.subscribe(stream, (update) => {
          socket.emit(stream, update);
        });
        unsubscribers.push(unsub);
      });
    });

    socket.on('unsubscribe', (_streams: string[]) => {
      // Handled by returning cleanup functions
    });

    socket.on('disconnect', (reason) => {
      connectedClients.delete(socket.id);
      unsubscribers.forEach(unsub => unsub());
      logger.info({ socketId: socket.id, reason }, 'Client disconnected');
    });

    socket.on('error', (error) => {
      logger.error({ socketId: socket.id, err: error }, 'Socket error');
    });
  });

  // Broadcast helper for server-side events
  io.broadcastState = (key: string, data: any) => {
    io.emit(key, { [key]: data });
  };

  io.getConnectedCount = () => connectedClients.size;
  io.getClientsByRole = (role: string) => Array.from(connectedClients.values()).filter(s => s.role === role);

  logger.info('Socket.IO server initialized');
  return io;
}

declare module 'socket.io' {
  interface Server {
    broadcastState: (key: string, data: any) => void;
    getConnectedCount: () => number;
    getClientsByRole: (role: string) => AuthenticatedSocket[];
  }
}