import { describe, it, expect } from 'vitest';
import {
  verifyToken,
  resolveCaptured,
  requireAuth,
  requirePrivileged,
  resolveEffectiveRole,
  canPerformPrivilegedAction,
  canManageSuggestions,
  isDeviceRole,
  isPrivilegedRole,
  isDeviceIdentityVerified,
  redactTokenForLogging,
  getDevTokenRegistrations,
  getAuthStatusForRequest,
  getRoleFromDevToken,
  DEV_TOKEN_ADMIN,
  DEV_TOKEN_DEVICE,
  DEV_TOKEN_VIEWER,
  buildSocketAuthContext,
  isVerifiedDevice,
} from '../src/services/auth.js';

function makeRequest(authorization?: string): { headers: Record<string, string> } {
  return {
    headers: authorization ? { authorization } : { authorization: '' },
  };
}

describe('auth integration', () => {
  describe('verifyToken', () => {
    it('rejects missing token', () => {
      expect(verifyToken(makeRequest())).toBeNull();
    });

    it('rejects non-placeholder token before real provider is wired', () => {
      expect(verifyToken(makeRequest('Bearer not-a-real-token'))).toBeNull();
    });
  });

  describe('resolveCaptured', () => {
    it('reuses an already set auth context', () => {
      const request = makeRequest() as any;
      request.authContext = { role: 'admin', userId: 'user', authMethod: 'dev-token' } as const;
      const auth = resolveCaptured(request);
      expect(auth.role).toBe('admin');
      expect(auth.userId).toBe('user');
    });

    it('falls back to unauthenticated when no credentials are present', () => {
      const auth = resolveCaptured(makeRequest());
      expect(auth.role).toBe('viewer');
      expect(auth.userId).toBe('anonymous');
    });
  });

  describe('requireAuth and requirePrivileged', () => {
    it('allows a real dev-admin token through requireAuth', async () => {
      const request = makeRequest(`Bearer ${DEV_TOKEN_ADMIN}`) as any;
      const reply = {
        code: (status: number) => ({
          send: (body: any) => ({ status, body }),
        }),
      } as any;
      await requireAuth(request, reply);
      expect(request.authContext?.userId).toBe('dev-admin');
    });

    it('returns 401 for an unauthenticated request', async () => {
      const request = makeRequest() as any;
      const replyCall: { status?: number; body?: unknown } = {};
      const reply = {
        code: (status: number) => ({
          send: (body: unknown) => {
            replyCall.status = status;
            replyCall.body = body;
          },
        }),
      } as any;
      await requireAuth(request, reply);
      expect(replyCall.status).toBe(401);
      expect((replyCall.body as { error: string }).error).toBe('Unauthorized');
    });

    it('allows a dev-admin token through requirePrivileged', async () => {
      const request = makeRequest(`Bearer ${DEV_TOKEN_ADMIN}`) as any;
      const reply = {
        code: (status: number) => ({
          send: (body: unknown) => ({ status, body }),
        }),
      } as any;
      await requirePrivileged(request, reply);
      expect(request.authContext?.userId).toBe('dev-admin');
    });

    it('returns 403 when the role is not privileged enough', async () => {
      const request = makeRequest(`Bearer ${DEV_TOKEN_VIEWER}`) as any;
      const replyCall: { status?: number; body?: unknown } = {};
      const reply = {
        code: (status: number) => ({
          send: (body: unknown) => {
            replyCall.status = status;
            replyCall.body = body;
          },
        }),
      } as any;
      await requirePrivileged(request, reply);
      expect(replyCall.status).toBe(403);
      expect((replyCall.body as { error: string }).error).toBe('Forbidden');
    });
  });

  describe('socket auth context', () => {
    it('builds a device context when the preconfigured device id is supplied', () => {
      const auth = buildSocketAuthContext(undefined, 'sensoura-esp32-01', undefined);
      expect(auth.role).toBe('device');
      expect(auth.authMethod).toBe('device-preconfigured');
      expect(auth.deviceId).toBe('sensoura-esp32-01');
      expect(auth.isDevice).toBe(true);
    });

    it('does not trust a raw client-supplied viewer role on its own', () => {
      const auth = buildSocketAuthContext(undefined, undefined, 'viewer');
      expect(auth.authMethod).toBe('unauthenticated');
      expect(auth.role).toBe('viewer');
    });

    it('falls back to unauthenticated viewer', () => {
      const auth = buildSocketAuthContext(undefined, undefined, undefined);
      expect(auth.authMethod).toBe('unauthenticated');
      expect(auth.role).toBe('viewer');
      expect(auth.isPrivileged).toBe(false);
    });

    it('trusts a verified dev JWT in the socket auth handshake', () => {
      const auth = buildSocketAuthContext(DEV_TOKEN_ADMIN, undefined, undefined);
      expect(auth.role).toBe('admin');
      expect(auth.authMethod).toBe('dev-token');
      expect(auth.deviceId).toBeUndefined();
    });

    it('validates device identity through the preconfigured device path', () => {
      const auth = buildSocketAuthContext(undefined, 'sensoura-esp32-01', undefined);
      expect(auth.role).toBe('device');
      expect(auth.authMethod).toBe('device-preconfigured');
      expect(auth.deviceId).toBe('sensoura-esp32-01');
      expect(auth.isDevice).toBe(true);
      expect(auth.isPrivileged).toBe(false);
    });

    it('does not trust a fake device id through the device path', () => {
      const auth = buildSocketAuthContext(undefined, 'fake-esp32', undefined);
      expect(auth.authMethod).toBe('unauthenticated');
      expect(auth.role).toBe('viewer');
      expect(auth.isDevice).toBe(false);
    });

    it('falls back to an unauthenticated viewer when no verified credentials are supplied', () => {
      const auth = buildSocketAuthContext(undefined, undefined, undefined);
      expect(auth.authMethod).toBe('unauthenticated');
      expect(auth.role).toBe('viewer');
      expect(auth.isPrivileged).toBe(false);
      expect(auth.isViewer).toBe(true);
    });
  });

  describe('authentication predicates and helpers', () => {
    it('verifies device identity through isDeviceIdentityVerified', () => {
      expect(isDeviceIdentityVerified({ isDevice: true, deviceId: 'dev-device' } as any)).toBe(true);
      expect(isDeviceIdentityVerified({ isDevice: false, deviceId: 'dev-device' } as any)).toBe(false);
      expect(isDeviceIdentityVerified('device')).toBe(false);
      expect(isDeviceIdentityVerified(undefined)).toBe(false);
    });

    it('verifies device ids through isVerifiedDevice', () => {
      expect(isVerifiedDevice('sensoura-esp32-01')).toBe(true);
      expect(isVerifiedDevice('dev-device')).toBe(false);
      expect(isVerifiedDevice('fake-esp32')).toBe(false);
      expect(isVerifiedDevice(undefined)).toBe(false);
    });

    it('verifies role predicates through the predicate functions', () => {
      expect(isDeviceRole('device')).toBe(true);
      expect(isDeviceRole('operator')).toBe(false);
      expect(isPrivilegedRole('admin')).toBe(true);
      expect(isPrivilegedRole('viewer')).toBe(false);
      expect(isPrivilegedRole(undefined)).toBe(false);
    });

    it('resolves effective roles through resolveEffectiveRole', () => {
      expect(resolveEffectiveRole({ role: 'admin', authMethod: 'dev-token' })).toBe('admin');
      expect(resolveEffectiveRole({ role: 'viewer', authMethod: 'unauthenticated' })).toBe('viewer');
      expect(resolveEffectiveRole('admin')).toBe('admin');
      expect(resolveEffectiveRole(undefined as any)).toBe('viewer');
      expect(resolveEffectiveRole('bogus' as any)).toBe('viewer');
    });

    it('checks authorization through canPerformPrivilegedAction and canManageSuggestions', () => {
      expect(canPerformPrivilegedAction('admin')).toBe(true);
      expect(canPerformPrivilegedAction('operator')).toBe(true);
      expect(canPerformPrivilegedAction({ role: 'viewer', authMethod: 'unauthenticated' })).toBe(false);
      expect(canPerformPrivilegedAction(undefined as any)).toBe(false);
      expect(canManageSuggestions('admin')).toBe(true);
      expect(canManageSuggestions('operator')).toBe(true);
      expect(canManageSuggestions({ role: 'viewer', authMethod: 'unauthenticated' })).toBe(false);
      expect(canManageSuggestions(undefined as any)).toBe(false);
    });

    it('redacts tokens through redactTokenForLogging', () => {
      expect(redactTokenForLogging('')).toBe('<token>');
      expect(redactTokenForLogging('ab')).toBe('<token>');
      expect(redactTokenForLogging('dev-token-abc')).toBe('dev-…-abc');
      expect(redactTokenForLogging('dev-token')).toBe('dev-…oken');
    });

    it('lists dev token registrations through getDevTokenRegistrations', () => {
      const registrations = getDevTokenRegistrations();
      const tokens = registrations.map((r) => r.token);
      expect(tokens).toContain(DEV_TOKEN_ADMIN);
      expect(tokens).toContain(DEV_TOKEN_DEVICE);
      expect(tokens).toContain(DEV_TOKEN_VIEWER);
      expect(tokens).toContain('dev-token');
      expect(registrations).toHaveLength(4);
    });

    it('returns dev-only from getAuthStatusForRequest when no production config is present', () => {
      const status = getAuthStatusForRequest(makeRequest());
      expect(status.devOnly).toBe(true);
      expect(status.when).toHaveProperty('devOnly', true);
    });

    it('returns the right dev token role from getRoleFromDevToken', () => {
      expect(getRoleFromDevToken(undefined)).toBeNull();
      expect(getRoleFromDevToken(DEV_TOKEN_ADMIN)).toBe('admin');
      expect(getRoleFromDevToken(DEV_TOKEN_DEVICE)).toBe('device');
      expect(getRoleFromDevToken(DEV_TOKEN_VIEWER)).toBe('viewer');
      expect(getRoleFromDevToken('dev-token')).toBe('operator');
      expect(getRoleFromDevToken('unknown')).toBeNull();
    });
  });
});
