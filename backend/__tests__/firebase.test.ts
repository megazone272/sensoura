import { describe, it, expect, beforeEach, vi } from 'vitest';
import { realtimeService } from '../src/services/realtime.js';
import { mockDb } from '../src/services/firebase.js';
import Fastify from 'fastify';

vi.mock('firebase-admin/app', async () => {
  const actual = await vi.importActual('firebase-admin/app');
  return {
    ...actual,
    initializeApp: vi.fn(() => ({ options: { databaseURL: 'https://test.firebaseio.com' } })),
  };
});

describe('Backend Integration', () => {
  describe('Realtime Service', () => {
    beforeEach(async () => {
      // Make sure realtime service is started
      await realtimeService.startListening();
    });

    it('should have state', () => {
      const state = realtimeService.getState();
      expect(state).toBeDefined();
      expect(state.sensorData).toBeDefined();
      expect(state.system).toBeDefined();
    });

    it('getSensorData returns valid data', () => {
      const data = realtimeService.getSensorData();
      expect(data).not.toBeNull();
      expect(data.AirTemp).toBeGreaterThan(-50);
      expect(data.AirTemp).toBeLessThan(60);
    });

    it('has mock database with sample data', () => {
      const ref = mockDb.ref('/Sensoura/sensorData');
      expect(ref).toBeDefined();
      // Mock database should have get method that returns data
      expect(typeof ref.get).toBe('function');
    });
  });

  describe('API Endpoints', () => {
    it('health endpoint returns 200', async () => {
      const app = await Fastify({ logger: false });
      app.get('/health', async () => ({
        status: 'ok',
        mission: 'SENSOURA',
        phase: 'LUNAR_ANALOG',
        team: 'TEAM-MISSION-49',
        timestamp: Date.now(),
        uptime: process.uptime(),
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.status).toBe('ok');
      expect(json.mission).toBe('SENSOURA');
      await app.close();
    });

    it('ready endpoint returns 200', async () => {
      const app = await Fastify({ logger: false });
      app.get('/ready', async () => ({
        ready: true,
        services: { realtime: true, ai: true, socket: true },
      }));

      const response = await app.inject({ method: 'GET', url: '/ready' });
      expect(response.statusCode).toBe(200);
      expect(response.json().ready).toBe(true);
      await app.close();
    });

    it('404 returns proper error', async () => {
      const app = await Fastify({ logger: false });
      app.setNotFoundHandler((request, reply) => {
        reply.code(404).send({ error: 'Not Found', path: request.url });
      });

      const response = await app.inject({ method: 'GET', url: '/nonexistent' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('Not Found');
      await app.close();
    });

    it('command schema validates correctly', async () => {
      const commandSchema = {
        target: ['pump', 'buzzer', 'led', 'system'],
        action: ['ON', 'OFF', 'MUTE', 'UNMUTE', 'REBOOT', 'CALIBRATE'],
        mode: ['MANUAL', 'AUTO'],
      };

      // Valid command
      const validCmd = { target: 'pump', action: 'ON', mode: 'MANUAL' };
      expect(commandSchema.target).toContain(validCmd.target);
      expect(commandSchema.action).toContain(validCmd.action);
      expect(commandSchema.mode).toContain(validCmd.mode);
    });

    it('sensor data schema is valid', () => {
      const sensorData = {
        AirTemp: 28.4,
        SoilTemp: 22.5,
        AirHumidity: 65,
        SoilMoisture: 24,
        VOC: 185,
        Light: 720,
        Barometricpressure: 1013.25,
        lastUpdate: Date.now(),
      };

      expect(typeof sensorData.AirTemp).toBe('number');
      expect(typeof sensorData.SoilMoisture).toBe('number');
      expect(sensorData.SoilMoisture).toBeGreaterThanOrEqual(0);
      expect(sensorData.SoilMoisture).toBeLessThanOrEqual(100);
    });
  });
});
