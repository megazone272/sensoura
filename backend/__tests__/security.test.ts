import Fastify from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerRoutes } from '../src/routes/index.js';
import { registerEmailRoutes } from '../src/routes/email.js';
import { registerDeviceRoutes } from '../src/routes/device.js';
import {
  verifyToken,
  buildSocketAuthContext,
  DEV_TOKEN_ADMIN,
  DEV_TOKEN_VIEWER,
  DEV_TOKEN,
  DEV_TOKEN_DEVICE,
} from '../src/services/auth.js';
import { envSchema } from '../src/config/env.js';

describe('Production Security Hardening Suite', () => {
  let app: ReturnType<typeof Fastify>;
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    savedEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    app = Fastify({ logger: false });
    await registerRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    process.env = savedEnv;
    vi.restoreAllMocks();
  });

  describe('1. Authentication Security & Dev Token Isolation', () => {
    it('completely rejects dev tokens when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';
      const fakeReq = { headers: { authorization: `Bearer ${DEV_TOKEN_ADMIN}` } } as any;
      expect(verifyToken(fakeReq)).toBeNull();

      const socketAuth = buildSocketAuthContext(DEV_TOKEN_ADMIN, undefined, undefined);
      expect(socketAuth.authMethod).toBe('unauthenticated');
      expect(socketAuth.isPrivileged).toBe(false);
    });

    it('rejects malformed and random bearer tokens', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/command',
        headers: { authorization: 'Bearer malformed-token-12345' },
        payload: { target: 'pump', action: 'ON', mode: 'MANUAL' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects oversized tokens immediately', async () => {
      const giantToken = 'a'.repeat(9000);
      const response = await app.inject({
        method: 'POST',
        url: '/api/command',
        headers: { authorization: `Bearer ${giantToken}` },
        payload: { target: 'pump', action: 'ON', mode: 'MANUAL' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('blocks dev-admin token on API endpoints when NODE_ENV is production', async () => {
      process.env.NODE_ENV = 'production';
      const response = await app.inject({
        method: 'POST',
        url: '/api/command',
        headers: { authorization: `Bearer ${DEV_TOKEN_ADMIN}` },
        payload: { target: 'pump', action: 'ON', mode: 'MANUAL' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('2. Role-Based Access Control & Privilege Restrictions', () => {
    it('restricts viewer accounts from sending hardware commands', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/command',
        headers: { authorization: `Bearer ${DEV_TOKEN_VIEWER}` },
        payload: { target: 'pump', action: 'ON', mode: 'MANUAL' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().message).toContain('Only operators and admins');
    });

    it('restricts viewer accounts from manual relay actuation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/relay',
        headers: { authorization: `Bearer ${DEV_TOKEN_VIEWER}` },
        payload: { state: 'ON', reason: 'manual override' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('restricts viewer accounts from buzzer control', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/buzzer',
        headers: { authorization: `Bearer ${DEV_TOKEN_VIEWER}` },
        payload: { action: 'MUTE' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('restricts viewer accounts from rebooting the system', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/system/reboot',
        headers: { authorization: `Bearer ${DEV_TOKEN_VIEWER}` },
      });
      expect(response.statusCode).toBe(403);
    });

    it('restricts viewer accounts from calibrating sensors', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/system/calibrate',
        headers: { authorization: `Bearer ${DEV_TOKEN_VIEWER}` },
      });
      expect(response.statusCode).toBe(403);
    });

    it('restricts viewer accounts from approving or rejecting AI suggestions', async () => {
      const approveRes = await app.inject({
        method: 'POST',
        url: '/api/ai-suggestions/sug_123/approve',
        headers: { authorization: `Bearer ${DEV_TOKEN_VIEWER}` },
      });
      expect(approveRes.statusCode).toBe(403);

      const rejectRes = await app.inject({
        method: 'POST',
        url: '/api/ai-suggestions/sug_123/reject',
        headers: { authorization: `Bearer ${DEV_TOKEN_VIEWER}` },
      });
      expect(rejectRes.statusCode).toBe(403);
    });

    it('restricts non-admin accounts from email administration', async () => {
      const operatorRes = await app.inject({
        method: 'GET',
        url: '/api/admin/email/status',
        headers: { authorization: `Bearer ${DEV_TOKEN}` }, // Operator role
      });
      expect(operatorRes.statusCode).toBe(403);

      const viewerRes = await app.inject({
        method: 'GET',
        url: '/api/admin/email/status',
        headers: { authorization: `Bearer ${DEV_TOKEN_VIEWER}` }, // Viewer role
      });
      expect(viewerRes.statusCode).toBe(403);
    });
  });

  describe('3. Hardware Command Validation & Anti-Tampering', () => {
    it('rejects commands with invalid hardware targets', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/command',
        headers: { authorization: `Bearer ${DEV_TOKEN_ADMIN}` },
        payload: { target: 'invalid_heater', action: 'ON', mode: 'MANUAL' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Invalid command');
    });

    it('rejects commands with invalid actions', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/command',
        headers: { authorization: `Bearer ${DEV_TOKEN_ADMIN}` },
        payload: { target: 'pump', action: 'DESTROY', mode: 'MANUAL' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('strictly forbids unknown parameters and prototype pollution payloads', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/command',
        headers: { authorization: `Bearer ${DEV_TOKEN_ADMIN}` },
        payload: {
          target: 'pump',
          action: 'ON',
          mode: 'MANUAL',
          __proto__: { admin: true },
          extraUnknownField: 'malicious',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects invalid suggestion IDs containing dangerous characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/ai-suggestions/%2E%2E%2Fevil/approve',
        headers: { authorization: `Bearer ${DEV_TOKEN_ADMIN}` },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('4. Device Authentication & Isolation Boundary', () => {
    it('prevents device identity tokens from accessing dashboard state endpoints', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/state',
        headers: { authorization: `Bearer ${DEV_TOKEN_DEVICE}` },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().message).toContain('Device identities cannot access the dashboard API');
    });

    it('prevents device identity tokens from accessing sensor data endpoints', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sensor-data',
        headers: { authorization: `Bearer ${DEV_TOKEN_DEVICE}` },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('5. Production Startup Configuration & Secret Fail-safes', () => {
    it('fails validation when DEVICE_AUTH_TOKEN is missing in production', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some(i => i.path.includes('DEVICE_AUTH_TOKEN'))).toBe(true);
      }
    });

    it('fails validation when DEVICE_AUTH_TOKEN is too short in production', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        DEVICE_AUTH_TOKEN: 'short-token-1234',
      });
      expect(result.success).toBe(false);
    });

    it('fails validation when DEVICE_AUTH_TOKEN is a placeholder in production', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        DEVICE_AUTH_TOKEN: 'placeholder-token-at-least-32-chars-long-xxx',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('placeholder'))).toBe(true);
      }
    });

    it('fails validation when JWT_SECRET is an insecure placeholder in production', () => {
      const result = envSchema.safeParse({
        NODE_ENV: 'production',
        DEVICE_AUTH_TOKEN: 'valid-secure-random-token-64-bytes-entropy-abc123456789',
        JWT_SECRET: 'your-super-secret-jwt-key-min-32-chars-change-in-production',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('Insecure JWT_SECRET'))).toBe(true);
      }
    });
  });
});

