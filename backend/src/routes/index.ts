import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getLogger } from '../utils/logger.js';
import { realtimeService } from '../services/realtime.js';
import { aiEngine } from '../ai/engine.js';
import { getEnv } from '../config/env.js';
import { registerDeviceRoutes } from './device.js';
import { registerEmailRoutes } from './email.js';
import { registerFirebaseEmailVerificationRoutes } from './firebaseEmailVerification.js';

import {
  requireAuth,
  requireUserAuth,
  requireMetricsAuth,
  isPrivilegedRole,
  resolveCaptured,
} from '../services/auth.js';

const logger = getLogger('routes');
const env = getEnv();

const commandSchema = z.object({
  target: z.enum(['pump', 'buzzer', 'led', 'system']),
  action: z.enum(['ON', 'OFF', 'MUTE', 'UNMUTE', 'REBOOT', 'CALIBRATE']),
  mode: z.enum(['MANUAL', 'AUTO']).default('MANUAL'),
}).strict();

const relaySchema = z.object({
  state: z.enum(['ON', 'OFF']),
  reason: z.string().trim().min(1).max(256),
}).strict();

const buzzerSchema = z.object({
  action: z.enum(['MUTE', 'UNMUTE']),
}).strict();

const suggestionIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

function notFound(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 404;
  return error;
}

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  registerDeviceRoutes(fastify);
  registerEmailRoutes(fastify);
  registerFirebaseEmailVerificationRoutes(fastify);

  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
  }));

  fastify.get('/ready', async (_request, reply) => {
    const realtimeReady = realtimeService.isRealtimeReady();
    const readiness = {
      ready: realtimeReady,
      timestamp: Date.now(),
    };
    if (!realtimeReady) return reply.code(503).send(readiness);
    return readiness;
  });

  // Current state
  fastify.get('/api/state', { preHandler: [requireUserAuth] }, async () => {
    return realtimeService.getState();
  });

  fastify.get('/api/sensor-data', { preHandler: [requireUserAuth] }, async () => {
    const data = realtimeService.getSensorData();
    if (!data) throw notFound('No sensor data available');
    return data;
  });

  fastify.get('/api/system', { preHandler: [requireUserAuth] }, async () => {
    const data = realtimeService.getSystemStatus();
    if (!data) throw notFound('No system status available');
    return data;
  });

  fastify.get('/api/commands', { preHandler: [requireUserAuth] }, async () => {
    return realtimeService.getCommands();
  });

  fastify.get('/api/command-results', { preHandler: [requireUserAuth] }, async () => {
    return realtimeService.getCommandResults();
  });

  fastify.get('/api/ai-suggestions', { preHandler: [requireUserAuth] }, async () => {
    return realtimeService.getAISuggestions();
  });

  // Send command
  fastify.post<{ Body: z.infer<typeof commandSchema> }>(
    '/api/command',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const auth = resolveCaptured(request);

      if (!isPrivilegedRole(auth.role)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only operators and admins can send commands',
        });
      }

      const parsed = commandSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid command', details: parsed.error.flatten() });
      }

      try {
        const commandId = await realtimeService.sendCommand(parsed.data);
        return { success: true, commandId };
      } catch (error) {
        logger.error({ err: error, by: auth.userId }, 'Failed to send command');
        return reply.code(500).send({ error: 'Failed to send command' });
      }
    },
  );

  // Approve/reject AI suggestion
  fastify.post<{ Params: { id: string } }>(
    '/api/ai-suggestions/:id/approve',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const suggestionId = suggestionIdSchema.safeParse(request.params.id);
      if (!suggestionId.success) return reply.code(400).send({ error: 'Invalid suggestion id' });
      const auth = resolveCaptured(request);

      if (!isPrivilegedRole(auth.role)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only operators and admins can approve suggestions',
        });
      }

      try {
        await realtimeService.approveSuggestion(suggestionId.data);
        logger.info({ suggestionId: suggestionId.data, by: auth.userId }, 'Suggestion approved');
        return { success: true };
      } catch (error) {
        logger.error({ err: error, suggestionId: request.params.id, by: auth.userId }, 'Failed to approve suggestion');
        return reply.code(500).send({ error: 'Failed to approve suggestion' });
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/ai-suggestions/:id/reject',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const suggestionId = suggestionIdSchema.safeParse(request.params.id);
      if (!suggestionId.success) return reply.code(400).send({ error: 'Invalid suggestion id' });
      const auth = resolveCaptured(request);

      if (!isPrivilegedRole(auth.role)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only operators and admins can reject suggestions',
        });
      }

      try {
        await realtimeService.rejectSuggestion(suggestionId.data);
        logger.info({ suggestionId: suggestionId.data, by: auth.userId }, 'Suggestion rejected');
        return { success: true };
      } catch (error) {
        logger.error({ err: error, suggestionId: request.params.id, by: auth.userId }, 'Failed to reject suggestion');
        return reply.code(500).send({ error: 'Failed to reject suggestion' });
      }
    },
  );

  // Manual relay control
  fastify.post<{ Body: z.infer<typeof relaySchema> }>(
    '/api/relay',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const auth = resolveCaptured(request);

      if (!isPrivilegedRole(auth.role)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only operators and admins can control the relay',
        });
      }

      const parsedBody = relaySchema.safeParse(request.body);
      if (!parsedBody.success) return reply.code(400).send({ error: 'Invalid relay request' });
      const { state, reason } = parsedBody.data;

      try {
        const commandId = await realtimeService.sendCommand({
          target: 'pump',
          action: state,
          mode: 'MANUAL',
        });
        return { success: true, commandId, reason };
      } catch (error) {
        logger.error({ err: error, by: auth.userId }, 'Failed to control relay');
        return reply.code(500).send({ error: 'Failed to control relay' });
      }
    },
  );

  // Buzzer control
  fastify.post<{ Body: z.infer<typeof buzzerSchema> }>(
    '/api/buzzer',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const auth = resolveCaptured(request);

      if (!isPrivilegedRole(auth.role)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only operators and admins can control the buzzer',
        });
      }

      const parsedBody = buzzerSchema.safeParse(request.body);
      if (!parsedBody.success) return reply.code(400).send({ error: 'Invalid buzzer request' });
      const { action } = parsedBody.data;

      try {
        const commandId = await realtimeService.sendCommand({
          target: 'buzzer',
          action,
          mode: 'MANUAL',
        });
        return { success: true, commandId };
      } catch (error) {
        logger.error({ err: error, by: auth.userId }, 'Failed to control buzzer');
        return reply.code(500).send({ error: 'Failed to control buzzer' });
      }
    },
  );

  // AI predictions endpoint
  fastify.get('/api/ai/predictions', { preHandler: [requireUserAuth] }, async () => {
    const sensorData = realtimeService.getSensorData();
    if (!sensorData) throw notFound('No sensor data for predictions');

    const predictions = {
      soilMoisture6h: aiEngine.predictSoilMoisture(sensorData, 6),
      gas3h: aiEngine.predictGasLevel(sensorData, 3),
      temperature12h: aiEngine.predictTemperature(sensorData, 12),
      suggestions: aiEngine.generateSuggestions(sensorData),
      timestamp: Date.now(),
    };

    return predictions;
  });

  // AI model info
  fastify.get('/api/ai/model-info', { preHandler: [requireUserAuth] }, async () => {
    return aiEngine.getModelInfo();
  });

  // Trigger model retraining (admin only)
  fastify.post(
    '/api/ai/retrain',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const auth = resolveCaptured(request);

      if (!isPrivilegedRole(auth.role)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only operators and admins can trigger retraining',
        });
      }

      logger.info({ by: auth.userId }, 'Manual retrain triggered');
      return { success: true, message: 'Retraining queued' };
    },
  );

  // Historical data (would query Firebase/Time-series DB)
  fastify.get('/api/history/sensor-data', { preHandler: [requireUserAuth] }, async (request) => {
    const querySchema = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(100),
    }).strict();
    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) throw Object.assign(new Error('Invalid history query'), { statusCode: 400 });
    const { limit } = parsedQuery.data;

    const isDevMockEnabled = env.NODE_ENV === 'development';

    if (!isDevMockEnabled) {
      return {
        data: [],
        count: 0,
        note: 'Historical sensor history is not available in this deployment. Persistent historical storage must be enabled before this endpoint returns real values.',
      };
    }

    const count = limit;

    const now = Date.now();
    const base = realtimeService.getSensorData();
    if (!base) {
      return {
        data: [],
        count: 0,
        note: 'No current sensor data available; historical data cannot be generated yet.',
      };
    }

    const data = Array.from({ length: count }, (_, i) => ({
      AirTemp: base.AirTemp + (Math.round((Math.random() - 0.5) * 5 * 10) / 10),
      SoilTemp: base.SoilTemp + (Math.round((Math.random() - 0.5) * 3 * 10) / 10),
      AirHumidity: base.AirHumidity + Math.round((Math.random() - 0.5) * 10),
      SoilMoisture: Math.max(0, Math.min(100, Math.round(base.SoilMoisture + (Math.random() - 0.5) * 20))),
      VOC: Math.max(0, Math.round(base.VOC + (Math.random() - 0.5) * 50)),
      Light: Math.max(0, Math.round(base.Light + (Math.random() - 0.5) * 200)),
      Barometricpressure: base.Barometricpressure + (Math.round((Math.random() - 0.5) * 10 * 100) / 100),
      timestamp: now - (count - i) * 300000,
    }));

    return {
      data,
      count,
      note: 'This endpoint is unavailable in production. Historical greenhouse sensor data requires a configured persistent store (for example Firebase) before it returns real values. During development, when no persistent store was configured, this endpoint returns a short, bounded placeholder batch generated from the current sensor state so the frontend can still render a chart; those values are not real historical sensor data and must not be interpreted as persisting history.',
    };
  });

  // System control
  fastify.post(
    '/api/system/reboot',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const auth = resolveCaptured(request);

      if (!isPrivilegedRole(auth.role)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only operators and admins can request a reboot',
        });
      }

      try {
        const commandId = await realtimeService.sendCommand({
          target: 'system',
          action: 'REBOOT',
          mode: 'MANUAL',
        });
        logger.info({ by: auth.userId }, 'System reboot requested');
        return { success: true, commandId };
      } catch (error) {
        logger.error({ err: error, by: auth.userId }, 'Failed to send reboot command');
        return reply.code(500).send({ error: 'Failed to send reboot command' });
      }
    },
  );

  fastify.post(
    '/api/system/calibrate',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const auth = resolveCaptured(request);

      if (!isPrivilegedRole(auth.role)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Only operators and admins can trigger calibration',
        });
      }

      try {
        const commandId = await realtimeService.sendCommand({
          target: 'system',
          action: 'CALIBRATE',
          mode: 'MANUAL',
        });
        logger.info({ by: auth.userId }, 'System calibration requested');
        return { success: true, commandId };
      } catch (error) {
        logger.error({ err: error, by: auth.userId }, 'Failed to send calibrate command');
        return reply.code(500).send({ error: 'Failed to send calibrate command' });
      }
    },
  );

  // Metrics endpoint (Prometheus format)
  fastify.get('/metrics', { preHandler: [requireMetricsAuth] }, async (_request, reply) => {
    const mem = process.memoryUsage();
    const state = realtimeService.getState();
    const sensorData = state.sensorData;
    reply.header('Content-Type', 'text/plain');
    return `
# HELP sensoura_uptime_seconds Process uptime in seconds
# TYPE sensoura_uptime_seconds gauge
sensoura_uptime_seconds ${process.uptime()}

# HELP sensoura_memory_bytes Memory usage in bytes
# TYPE sensoura_memory_bytes gauge
sensoura_memory_bytes{type="rss"} ${mem.rss}
sensoura_memory_bytes{type="heapUsed"} ${mem.heapUsed}
sensoura_memory_bytes{type="heapTotal"} ${mem.heapTotal}

# HELP sensoura_sensor_value Current sensor readings
# TYPE sensoura_sensor_value gauge
sensoura_sensor_value{sensor="AirTemp"} ${sensorData?.AirTemp ?? 0}
sensoura_sensor_value{sensor="SoilTemp"} ${sensorData?.SoilTemp ?? 0}
sensoura_sensor_value{sensor="AirHumidity"} ${sensorData?.AirHumidity ?? 0}
sensoura_sensor_value{sensor="SoilMoisture"} ${sensorData?.SoilMoisture ?? 0}
sensoura_sensor_value{sensor="VOC"} ${sensorData?.VOC ?? 0}
sensoura_sensor_value{sensor="Light"} ${sensorData?.Light ?? 0}
sensoura_sensor_value{sensor="Barometricpressure"} ${sensorData?.Barometricpressure ?? 0}

# HELP sensoura_relay_state Relay state (1=ON, 0=OFF)
# TYPE sensoura_relay_state gauge
sensoura_relay_state ${state.system?.relay?.state === 'ON' ? 1 : 0}

# HELP sensoura_ai_suggestions_pending Pending AI suggestions count
# TYPE sensoura_ai_suggestions_pending gauge
sensoura_ai_suggestions_pending ${Object.values(state.aiSuggestions ?? {}).filter(s => s.status === 'pending').length}

# HELP sensoura_connected_clients Connected WebSocket clients
# TYPE sensoura_connected_clients gauge
sensoura_connected_clients 0
`.trim();
  });
}
