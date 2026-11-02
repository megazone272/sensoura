import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deviceTelemetrySchema } from '../models/sensoura.js';
import { requireDeviceAuth } from '../services/auth.js';
import { realtimeService } from '../services/realtime.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('device-routes');
const COMMAND_MAX_AGE_MS = 2 * 60_000;
const CLOCK_SKEW_MS = 60_000;
const MAX_RESULT_AGE_MS = 5 * 60_000;

const commandResultSchema = z.object({
  commandId: z.string().regex(/^cmd_[A-Za-z0-9_-]{1,120}$/),
  status: z.enum(['executed', 'failed', 'timeout']),
  target: z.enum(['pump', 'buzzer', 'led', 'system']),
  requestedAction: z.enum(['ON', 'OFF', 'MUTE', 'UNMUTE', 'REBOOT', 'CALIBRATE']),
  actualState: z.string().min(1).max(64),
  message: z.string().max(256),
  timestamp: z.number().int().nonnegative(),
}).strict();

type DeviceCommandResult = z.infer<typeof commandResultSchema>;

function isDuplicateCommandResult(existing: unknown, candidate: DeviceCommandResult): boolean {
  if (!existing || typeof existing !== 'object') return false;
  const stored = existing as Record<string, unknown>;
  // Firmware refreshes timestamp on retries; it is freshness metadata, not part
  // of the execution outcome used for idempotency.
  return stored.commandId === candidate.commandId
    && stored.status === candidate.status
    && stored.target === candidate.target
    && stored.requestedAction === candidate.requestedAction
    && stored.actualState === candidate.actualState
    && stored.message === candidate.message;
}

export function registerDeviceRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/device/commands', { preHandler: [requireDeviceAuth] }, async (request, reply) => {
    const auth = request.authContext;
    if (!auth?.isDevice || !auth.deviceId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const now = Date.now();
    const commands = realtimeService.getCommands();
    const results = realtimeService.getCommandResults();
    const pending = Object.fromEntries(Object.entries(commands).filter(([id, command]) => (
      command.deviceId === auth.deviceId
      && !results[id]
      && command.timestamp >= now - COMMAND_MAX_AGE_MS
      && command.timestamp <= now + CLOCK_SKEW_MS
    )));
    return pending;
  });

  fastify.post('/api/device/telemetry', { preHandler: [requireDeviceAuth] }, async (request, reply) => {
    const auth = request.authContext;
    if (!auth?.isDevice || !auth.deviceId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const parsed = deviceTelemetrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid telemetry', details: parsed.error.flatten() });
    }
    if (parsed.data.system.deviceId !== auth.deviceId) {
      return reply.code(403).send({ error: 'Device identity mismatch' });
    }

    const now = Date.now();
    const sensorTime = parsed.data.sensorData.lastUpdate;
    const heartbeatTime = parsed.data.system.lastSeen;
    if (sensorTime < now - MAX_RESULT_AGE_MS || sensorTime > now + CLOCK_SKEW_MS
      || heartbeatTime < now - MAX_RESULT_AGE_MS || heartbeatTime > now + CLOCK_SKEW_MS) {
      return reply.code(400).send({ error: 'Telemetry timestamp is stale or outside the accepted clock window' });
    }

    try {
      await realtimeService.handleDeviceTelemetry(auth, parsed.data);
      return { success: true, receivedAt: now };
    } catch (error) {
      logger.error({ err: error, deviceId: auth.deviceId }, 'Failed to persist device telemetry');
      return reply.code(503).send({ error: 'Telemetry could not be persisted' });
    }
  });

  fastify.post<{ Params: { id: string } }>(
    '/api/device/command-results/:id',
    { preHandler: [requireDeviceAuth] },
    async (request, reply) => {
      const auth = request.authContext;
      if (!auth?.isDevice || !auth.deviceId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const parsed = commandResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid command result', details: parsed.error.flatten() });
      }
      const result = parsed.data;
      if (result.commandId !== request.params.id) {
        return reply.code(400).send({ error: 'Command id does not match request path' });
      }

      const command = realtimeService.getCommands()[request.params.id];
      if (!command) return reply.code(404).send({ error: 'Command not found' });
      if (command.deviceId !== auth.deviceId) {
        return reply.code(403).send({ error: 'Command belongs to another device' });
      }
      if (command.target !== result.target || command.action !== result.requestedAction) {
        return reply.code(409).send({ error: 'Result does not match the requested command' });
      }
      const now = Date.now();
      if (result.timestamp < now - MAX_RESULT_AGE_MS || result.timestamp > now + CLOCK_SKEW_MS) {
        return reply.code(400).send({ error: 'Command result timestamp is stale' });
      }
      const existingResult = realtimeService.getCommandResults()[request.params.id];
      if (existingResult) {
        if (isDuplicateCommandResult(existingResult, result)) {
          return reply.code(200).send({ success: true, duplicate: true });
        }
        return reply.code(409).send({ error: 'Conflicting command result already recorded' });
      }

      try {
        await realtimeService.recordCommandResult(request.params.id, result);
        return { success: true, duplicate: false };
      } catch (error) {
        const recordedResult = realtimeService.getCommandResults()[request.params.id];
        if (recordedResult) {
          if (isDuplicateCommandResult(recordedResult, result)) {
            return reply.code(200).send({ success: true, duplicate: true });
          }
          return reply.code(409).send({ error: 'Conflicting command result already recorded' });
        }
        logger.warn({ err: error, commandId: request.params.id, deviceId: auth.deviceId }, 'Failed to persist device command result');
        return reply.code(503).send({ error: 'Command result could not be persisted; retry later' });
      }
    },
  );
}
