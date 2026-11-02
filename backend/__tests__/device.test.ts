import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDeviceRoutes } from '../src/routes/device.js';
import { realtimeService } from '../src/services/realtime.js';

const DEVICE_ID = 'sensoura-test-device';
const DEVICE_TOKEN = 'device-test-token-'.padEnd(40, 'x');
let app: ReturnType<typeof Fastify>;
let previousEnv: { nodeEnv?: string; deviceId?: string; deviceToken?: string };

function telemetry(deviceId = DEVICE_ID) {
  const now = Date.now();
  return {
    sensorData: {
      AirTemp: 22,
      SoilTemp: 20,
      AirHumidity: 45,
      SoilMoisture: 50,
      VOC: 400,
      Light: 500,
      Barometricpressure: 1013,
      lastUpdate: now,
    },
    system: {
      status: 'online',
      lastSeen: now,
      deviceId,
      relay: { mode: 'AUTO', state: 'OFF', reason: 'boot', lastAction: now },
      buzzer: { muted: false },
      leds: { green: false, red: true },
    },
  };
}

function authHeaders(token = DEVICE_TOKEN) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(async () => {
  previousEnv = {
    nodeEnv: process.env.NODE_ENV,
    deviceId: process.env.DEVICE_ID,
    deviceToken: process.env.DEVICE_AUTH_TOKEN,
  };
  process.env.NODE_ENV = 'test';
  process.env.DEVICE_ID = DEVICE_ID;
  process.env.DEVICE_AUTH_TOKEN = DEVICE_TOKEN;
  app = Fastify({ logger: false });
  registerDeviceRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
  if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnv.nodeEnv;
  if (previousEnv.deviceId === undefined) delete process.env.DEVICE_ID;
  else process.env.DEVICE_ID = previousEnv.deviceId;
  if (previousEnv.deviceToken === undefined) delete process.env.DEVICE_AUTH_TOKEN;
  else process.env.DEVICE_AUTH_TOKEN = previousEnv.deviceToken;
});

describe('authenticated device API', () => {
  it('rejects absent and invalid device bearer credentials', async () => {
    const absent = await app.inject({ method: 'GET', url: '/api/device/commands' });
    const invalid = await app.inject({ method: 'GET', url: '/api/device/commands', headers: authHeaders('wrong') });
    expect(absent.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
  });

  it('returns only fresh, unreported commands for the authenticated device', async () => {
    const now = Date.now();
    vi.spyOn(realtimeService, 'getCommands').mockReturnValue({
      own: { id: 'own', target: 'pump', action: 'ON', mode: 'MANUAL', timestamp: now, deviceId: DEVICE_ID },
      other: { id: 'other', target: 'pump', action: 'OFF', mode: 'MANUAL', timestamp: now, deviceId: 'other-device' },
      stale: { id: 'stale', target: 'pump', action: 'ON', mode: 'MANUAL', timestamp: now - 180_000, deviceId: DEVICE_ID },
      reported: { id: 'reported', target: 'pump', action: 'OFF', mode: 'MANUAL', timestamp: now, deviceId: DEVICE_ID },
    } as any);
    vi.spyOn(realtimeService, 'getCommandResults').mockReturnValue({ reported: { status: 'executed' } } as any);

    const response = await app.inject({ method: 'GET', url: '/api/device/commands', headers: authHeaders() });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json())).toEqual(['own']);
  });

  it('rejects telemetry for a different device and unknown fields', async () => {
    const wrongIdentity = await app.inject({
      method: 'POST', url: '/api/device/telemetry', headers: authHeaders(), payload: telemetry('other-device'),
    });
    const extraFieldPayload = telemetry() as any;
    extraFieldPayload.sensorData.admin = true;
    const unknownField = await app.inject({
      method: 'POST', url: '/api/device/telemetry', headers: authHeaders(), payload: extraFieldPayload,
    });
    expect(wrongIdentity.statusCode).toBe(403);
    expect(unknownField.statusCode).toBe(400);
  });

  it('persists a valid authenticated telemetry payload through the realtime service', async () => {
    const persist = vi.spyOn(realtimeService, 'handleDeviceTelemetry').mockResolvedValue(undefined);
    const payload = telemetry();
    const response = await app.inject({ method: 'POST', url: '/api/device/telemetry', headers: authHeaders(), payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ authMethod: 'device-bearer', deviceId: DEVICE_ID }), payload);
  });

  it('acknowledges matching command result replays and rejects conflicting replays', async () => {
    const commandId = 'cmd_12345_abcdef';
    const command = { id: commandId, target: 'pump', action: 'ON', mode: 'MANUAL', timestamp: Date.now(), deviceId: DEVICE_ID };
    const results = vi.spyOn(realtimeService, 'getCommandResults').mockReturnValue({});
    vi.spyOn(realtimeService, 'getCommands').mockReturnValue({ [commandId]: command } as any);
    const record = vi.spyOn(realtimeService, 'recordCommandResult').mockResolvedValue(undefined);
    const payload = {
      commandId,
      status: 'executed',
      target: 'pump',
      requestedAction: 'ON',
      actualState: 'ON',
      message: 'OK',
      timestamp: Date.now(),
    };

    const first = await app.inject({
      method: 'POST', url: `/api/device/command-results/${commandId}`, headers: authHeaders(), payload,
    });
    expect(first.statusCode).toBe(200);
    expect(record).toHaveBeenCalledTimes(1);

    results.mockReturnValue({ [commandId]: { ...payload, commandId } } as any);
    const replay = await app.inject({
      method: 'POST', url: `/api/device/command-results/${commandId}`, headers: authHeaders(),
      payload: { ...payload, timestamp: payload.timestamp + 1000 },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ success: true, duplicate: true });
    expect(record).toHaveBeenCalledTimes(1);

    results.mockReturnValue({ [commandId]: { ...payload, commandId, message: 'Different outcome' } } as any);
    const conflict = await app.inject({
      method: 'POST', url: `/api/device/command-results/${commandId}`, headers: authHeaders(), payload,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('Conflicting command result already recorded');
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('returns retryable 503 when command result persistence fails', async () => {
    const commandId = 'cmd_23456_abcdef';
    const command = { id: commandId, target: 'pump', action: 'ON', mode: 'MANUAL', timestamp: Date.now(), deviceId: DEVICE_ID };
    vi.spyOn(realtimeService, 'getCommands').mockReturnValue({ [commandId]: command } as any);
    vi.spyOn(realtimeService, 'getCommandResults').mockReturnValue({});
    vi.spyOn(realtimeService, 'recordCommandResult').mockRejectedValue(new Error('storage unavailable'));
    const payload = {
      commandId,
      status: 'executed',
      target: 'pump',
      requestedAction: 'ON',
      actualState: 'ON',
      message: 'OK',
      timestamp: Date.now(),
    };

    const response = await app.inject({
      method: 'POST', url: `/api/device/command-results/${commandId}`, headers: authHeaders(), payload,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('Command result could not be persisted; retry later');
  });
});
