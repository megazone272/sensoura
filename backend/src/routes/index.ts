import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getLogger } from '../utils/logger.js';
import { realtimeService } from '../services/realtime.js';
import { isFirebaseEnabled } from '../services/firebase.js';
import { aiEngine } from '../ai/engine.js';
import { getEnv } from '../config/env.js';

const logger = getLogger('routes');
const env = getEnv();

const commandSchema = z.object({
  target: z.enum(['pump', 'buzzer', 'led', 'system']),
  action: z.enum(['ON', 'OFF', 'MUTE', 'UNMUTE', 'REBOOT', 'CALIBRATE']),
  mode: z.enum(['MANUAL', 'AUTO']).default('MANUAL'),
});

function notFound(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 404;
  return error;
}

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    mission: env.MISSION_NAME,
    phase: env.MISSION_PHASE,
    team: env.TEAM_ID,
    timestamp: Date.now(),
    uptime: process.uptime(),
    firebase: !isFirebaseEnabled()
      ? 'mock'
      : realtimeService.isUsingRestFallback()
        ? 'rest-fallback'
        : 'sdk',
    aiBackend: aiEngine.getModelInfo().backend,
  }));

  fastify.get('/ready', async () => ({
    ready: true,
    services: {
      realtime: true,
      ai: true,
      socket: true,
    },
  }));

  // Current state
  fastify.get('/api/state', async () => {
    return realtimeService.getState();
  });

  fastify.get('/api/sensor-data', async () => {
    const data = realtimeService.getSensorData();
    if (!data) throw notFound('No sensor data available');
    return data;
  });

  fastify.get('/api/system', async () => {
    const data = realtimeService.getSystemStatus();
    if (!data) throw notFound('No system status available');
    return data;
  });

  fastify.get('/api/commands', async () => {
    return realtimeService.getCommands();
  });

  fastify.get('/api/command-results', async () => {
    return realtimeService.getCommandResults();
  });

  fastify.get('/api/ai-suggestions', async () => {
    return realtimeService.getAISuggestions();
  });

  // Send command
  fastify.post<{ Body: z.infer<typeof commandSchema> }>('/api/command', async (request, reply) => {
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid command', details: parsed.error.flatten() });
    }

    try {
      const commandId = await realtimeService.sendCommand(parsed.data);
      return { success: true, commandId };
    } catch (error) {
      logger.error({ err: error }, 'Failed to send command');
      return reply.code(500).send({ error: 'Failed to send command' });
    }
  });

  // Approve/reject AI suggestion
  fastify.post<{ Params: { id: string } }>('/api/ai-suggestions/:id/approve', async (request, reply) => {
    try {
      await realtimeService.approveSuggestion(request.params.id);
      return { success: true };
    } catch (error) {
      logger.error({ err: error, suggestionId: request.params.id }, 'Failed to approve suggestion');
      return reply.code(500).send({ error: 'Failed to approve suggestion' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/api/ai-suggestions/:id/reject', async (request, reply) => {
    try {
      await realtimeService.rejectSuggestion(request.params.id);
      return { success: true };
    } catch (error) {
      logger.error({ err: error, suggestionId: request.params.id }, 'Failed to reject suggestion');
      return reply.code(500).send({ error: 'Failed to reject suggestion' });
    }
  });

  // Manual relay control
  fastify.post<{ Body: { state: 'ON' | 'OFF'; reason: string } }>('/api/relay', async (request, reply) => {
    const { state, reason } = request.body;
    if (!['ON', 'OFF'].includes(state)) {
      return reply.code(400).send({ error: 'Invalid state' });
    }

    try {
      const commandId = await realtimeService.sendCommand({
        target: 'pump',
        action: state,
        mode: 'MANUAL',
      });
      return { success: true, commandId, reason };
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to control relay' });
    }
  });

  // Buzzer control
  fastify.post<{ Body: { action: 'MUTE' | 'UNMUTE' } }>('/api/buzzer', async (request, reply) => {
    const { action } = request.body;
    if (!['MUTE', 'UNMUTE'].includes(action)) {
      return reply.code(400).send({ error: 'Invalid action' });
    }

    try {
      const commandId = await realtimeService.sendCommand({
        target: 'buzzer',
        action,
        mode: 'MANUAL',
      });
      return { success: true, commandId };
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to control buzzer' });
    }
  });

  // AI predictions endpoint
  fastify.get('/api/ai/predictions', async () => {
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
  fastify.get('/api/ai/model-info', async () => {
    return aiEngine.getModelInfo();
  });

  // Trigger model retraining (admin only)
  fastify.post('/api/ai/retrain', async () => {
    // In production, add admin auth check
    logger.info('Manual retrain triggered');
    // Would trigger background job
    return { success: true, message: 'Retraining queued' };
  });

  // Historical data (would query Firebase/Time-series DB)
  fastify.get('/api/history/sensor-data', async (request) => {
    const { limit = '100' } = request.query as { limit?: string };
    // Mock historical data
    const now = Date.now();
    const count = Math.min(parseInt(limit), 500);
    const data = Array.from({ length: count }, (_, i) => ({
      temperature: 28.4 + (Math.random() - 0.5) * 5,
      soilTemperature: 22.5 + (Math.random() - 0.5) * 3,
      humidity: 65 + (Math.random() - 0.5) * 10,
      soilMoisture: Math.max(0, Math.min(100, 24 + (Math.random() - 0.5) * 20)),
      gas: 185 + Math.floor((Math.random() - 0.5) * 50),
      light: 720 + Math.floor((Math.random() - 0.5) * 200),
      airPressure: 1013.25 + (Math.random() - 0.5) * 10,
      timestamp: now - (count - i) * 300000, // 5 min intervals
    }));
    return { data, count };
  });

  // System control
  fastify.post('/api/system/reboot', async (request, reply) => {
    try {
      const commandId = await realtimeService.sendCommand({
        target: 'system',
        action: 'REBOOT',
        mode: 'MANUAL',
      });
      return { success: true, commandId };
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to send reboot command' });
    }
  });

  fastify.post('/api/system/calibrate', async (request, reply) => {
    try {
      const commandId = await realtimeService.sendCommand({
        target: 'system',
        action: 'CALIBRATE',
        mode: 'MANUAL',
      });
      return { success: true, commandId };
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to send calibrate command' });
    }
  });

  // Metrics endpoint (Prometheus format)
  fastify.get('/metrics', async (request, reply) => {
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
sensoura_sensor_value{sensor="temperature"} ${sensorData?.temperature ?? 0}
sensoura_sensor_value{sensor="soilTemperature"} ${sensorData?.soilTemperature ?? 0}
sensoura_sensor_value{sensor="humidity"} ${sensorData?.humidity ?? 0}
sensoura_sensor_value{sensor="soilMoisture"} ${sensorData?.soilMoisture ?? 0}
sensoura_sensor_value{sensor="gas"} ${sensorData?.gas ?? 0}
sensoura_sensor_value{sensor="light"} ${sensorData?.light ?? 0}
sensoura_sensor_value{sensor="airPressure"} ${sensorData?.airPressure ?? 0}

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