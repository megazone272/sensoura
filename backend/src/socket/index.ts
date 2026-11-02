import { Server as SocketIOServer, Socket } from 'socket.io';
import { getLogger } from '../utils/logger.js';
import {
  buildSocketAuthContext,
  buildSocketAuthContextWithFirebase,
  AuthContext,
} from '../services/auth.js';
import { realtimeService } from '../services/realtime.js';

const logger = getLogger('socket');

// ---------------------------------------------------------------------------
// Device telemetry/control uses the authenticated HTTPS REST endpoints only.
// Socket.IO is reserved for dashboard users; the firmware does not connect here.
// ---------------------------------------------------------------------------

export type IOHookResult =
  | { ok: true; authContext: AuthContext }
  | {
      ok: false;
      reason: 'auth_missing' | 'auth_invalid' | 'device_not_allowed';
    };

export function buildSocketAuthContextFromPayload(
  token: string | undefined,
  deviceId: string | undefined,
  clientRole: string | undefined,
): AuthContext {
  return buildSocketAuthContext(token, deviceId, clientRole);
}

export async function buildSocketAuthContextFromSocket(
  socket: Socket,
): Promise<IOHookResult> {
  const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
  const deviceId = typeof socket.handshake.auth?.deviceId === 'string' ? socket.handshake.auth.deviceId : undefined;
  const clientRole = socket.handshake.auth?.role as string | undefined;

  const authContext = await buildSocketAuthContextWithFirebase(
    token,
    deviceId,
    clientRole,
  );

  if (authContext.authMethod === 'unauthenticated') {
    return { ok: false, reason: token ? 'auth_invalid' : 'auth_missing' };
  }

  if (authContext.isDevice) {
    return { ok: false, reason: 'device_not_allowed' };
  }

  return { ok: true, authContext };
}

export function registerSocketHooks(
  io: SocketIOServer,
  _frontendUrl: string | string[],
): void {
  // trust proxy is a Fastify configuration, not a Socket.IO Server method.

  io.use((socket, next) => {
    void buildSocketAuthContextFromSocket(socket).then((result) => {
      if (!result.ok) {
        logger.warn(
          {
            reason: result.reason,
            ip: socket.handshake.address,
          },
          'Socket.IO connection rejected',
        );
        next(new Error(`connection rejected: ${result.reason}`));
        return;
      }

      socket.data.authContext = result.authContext;
      next();
    }).catch((error) => {
      logger.warn({ error: (error as Error).message, ip: socket.handshake.address }, 'Socket.IO authentication failed');
      next(new Error('connection rejected: auth_invalid'));
    });
  });

  io.on('connection', (socket) => {
    const auth = socket.data.authContext;

    logger.info(
      {
        userId: auth.userId,
        role: auth.role,
        deviceId: auth.deviceId,
        ip: socket.handshake.address,
      },
      'Socket.IO client connected',
    );

    socket.join('frontend');
    socket.emit('init', realtimeService.getState());

    socket.on('disconnect', (reason) => {
      logger.info(
        { userId: auth.userId, reason },
        'Socket.IO client disconnected',
      );
    });
  });

  const stateUpdateHandler = (update: Record<string, unknown>) => {
    io.to('frontend').emit('state:update', update);
  };
  realtimeService.on('update', stateUpdateHandler);
  (io as any).once('close', () => realtimeService.off('update', stateUpdateHandler));

  // Transmit real-time updates to connected frontend clients.
  realtimeService.onTelemetryUpdate((payload) => {
    io.to('frontend').emit('sensor:update', payload);
  });

  realtimeService.onCommandFeedback((feedback) => {
    io.to('frontend').emit('command:feedback', feedback);
  });
}

export function initializeSocketIO(
  server: any,
  frontendUrl: string | string[],
): SocketIOServer {
  const io = new SocketIOServer(server, {
    cors: {
      origin: frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  registerSocketHooks(io, frontendUrl);

  logger.info({ frontendUrl }, 'Socket.IO initialized');

  return io;
}
