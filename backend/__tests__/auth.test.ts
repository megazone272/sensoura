import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  verifyToken,
  verifyDeviceToken,
  buildFirebaseAuthContextFromClaims,
  isDisposableEmailAddress,
  isEligibleFirebaseUserClaims,
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
  isVerifiedDevice,
  DEV_TOKEN,
  DEV_TOKEN_ADMIN,
  DEV_TOKEN_DEVICE,
  DEV_TOKEN_VIEWER,
  _registerDevTokenInternal,
} from '../src/services/auth.js';

// Lightweight request stub that mirrors the auth module's readBearerToken
// expectations: a string `authorization` header is enough for these unit
// tests because verifyToken only inspects that header for the dev-token path.
function makeRequest(bearer?: string): { headers: Record<string, string> } {
  return {
    headers: bearer ? { authorization: bearer } : {},
  };
}

describe('auth primitives', () => {
  describe('verifyToken', () => {
    it('accepts the dev placeholder token with operator role', () => {
      expect(verifyToken(makeRequest('Bearer dev-token'))).toEqual({
        userId: 'dev-user',
        role: 'operator',
        authMethod: 'dev-token',
        deviceId: undefined,
        isPrivileged: true,
        isDevice: false,
        isViewer: false,
      });
    });

    it('rejects built-in development credentials in production mode', () => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(verifyToken(makeRequest('Bearer dev-token-admin'))).toBeNull();
        expect(verifyToken(makeRequest('Bearer sensoura-esp32-01'))).toBeNull();
      } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
      }
    });

    it('accepts the dev admin placeholder token', () => {
      expect(verifyToken(makeRequest('Bearer dev-token-admin'))).toEqual({
        userId: 'dev-admin',
        role: 'admin',
        authMethod: 'dev-token',
        deviceId: undefined,
        isPrivileged: true,
        isDevice: false,
        isViewer: false,
      });
    });

    it('accepts the dev viewer placeholder token', () => {
      expect(verifyToken(makeRequest('Bearer dev-token-viewer'))).toEqual({
        userId: 'dev-viewer',
        role: 'viewer',
        authMethod: 'dev-token',
        deviceId: undefined,
        isPrivileged: false,
        isDevice: false,
        isViewer: true,
      });
    });

    it('accepts the dev device placeholder token', () => {
      expect(verifyToken(makeRequest('Bearer dev-token-device'))).toEqual({
        userId: 'dev-device',
        role: 'device',
        authMethod: 'dev-token',
        deviceId: 'sensoura-esp32-01',
        isPrivileged: false,
        isDevice: true,
        isViewer: false,
      });
    });

    it('rejects an unknown bearer token', () => {
      expect(verifyToken(makeRequest('Bearer not-a-real-token'))).toBeNull();
    });

    it('rejects a request with no authorization header', () => {
      expect(verifyToken(makeRequest())).toBeNull();
    });

    it('rejects a malformed authorization header', () => {
      expect(verifyToken(makeRequest('Basic abc'))).toBeNull();
      expect(verifyToken(makeRequest('Bearer'))).toBeNull();
      expect(verifyToken(makeRequest('Bearer   '))).toBeNull();
    });
  });

  describe('resolveCaptured', () => {
    it('returns a dev authenticated context when the request carries a known dev token', () => {
      const request = makeRequest('Bearer dev-token');
      const auth = resolveCaptured(request);
      expect(auth.userId).toBe('dev-user');
      expect(auth.role).toBe('operator');
      expect(auth.authMethod).toBe('dev-token');
      expect((request as any).authContext).toBe(auth);
    });

    it('returns an unauthenticated fallback when no credentials are present', () => {
      const request = makeRequest();
      const auth = resolveCaptured(request);
      expect(auth.authMethod).toBe('unauthenticated');
      expect(auth.role).toBe('viewer');
      expect(auth.userId).toBe('anonymous');
    });

    it('preserves an already-captured authenticated context on the request', () => {
      const existing = {
        userId: 'captured-user',
        role: 'operator' as const,
        authMethod: 'dev-token' as const,
        deviceId: undefined,
        isPrivileged: true,
        isDevice: false,
        isViewer: false,
      };
      const request = makeRequest() as any;
      request.authContext = existing;
      const auth = resolveCaptured(request);
      expect(auth).toBe(existing);
    });
  });

  describe('requireAuth', () => {
    it('attaches an auth context for a known dev token', async () => {
      const request = makeRequest('Bearer dev-token') as any;
      let capturedStatus: number | undefined = undefined;
      let capturedBody: any = undefined;
      const reply = {
        code: (status: number) => {
          capturedStatus = status;
          return {
            send: (body: any) => {
              capturedBody = body;
              return { status, body };
            },
          };
        },
      } as any;
      await requireAuth(request, reply);
      expect(request.authContext).toBeTruthy();
      expect(request.authContext!.userId).toBe('dev-user');
      expect(capturedStatus).toBeUndefined();
    });

    it('returns 401 for an unauthenticated request', async () => {
      const request = makeRequest() as any;
      let capturedStatus: number | undefined = undefined;
      let capturedBody: any = undefined;
      const reply = {
        code: (status: number) => {
          capturedStatus = status;
          return {
            send: (body: any) => {
              capturedBody = body;
              return { status, body };
            },
          };
        },
      } as any;
      await requireAuth(request, reply);
      expect(capturedStatus).toBe(401);
      expect(capturedBody.error).toBe('Unauthorized');
    });
  });

  describe('requirePrivileged', () => {
    it('allows an operator token', async () => {
      const request = makeRequest('Bearer dev-token') as any;
      let capturedStatus: number | undefined = undefined;
      let capturedBody: any = undefined;
      const reply = {
        code: (status: number) => {
          capturedStatus = status;
          return {
            send: (body: any) => {
              capturedBody = body;
              return { status, body };
            },
          };
        },
      } as any;
      await requirePrivileged(request, reply);
      expect(request.authContext!.isPrivileged).toBe(true);
      expect(capturedStatus).toBeUndefined();
    });

    it('allows an admin token', async () => {
      const request = makeRequest('Bearer dev-token-admin') as any;
      let capturedStatus: number | undefined = undefined;
      let capturedBody: any = undefined;
      const reply = {
        code: (status: number) => {
          capturedStatus = status;
          return {
            send: (body: any) => {
              capturedBody = body;
              return { status, body };
            },
          };
        },
      } as any;
      await requirePrivileged(request, reply);
      expect(request.authContext!.isPrivileged).toBe(true);
      expect(capturedStatus).toBeUndefined();
    });

    it('returns 401 when no credentials are present', async () => {
      const request = makeRequest() as any;
      let capturedStatus: number | undefined = undefined;
      let capturedBody: any = undefined;
      const reply = {
        code: (status: number) => {
          capturedStatus = status;
          return {
            send: (body: any) => {
              capturedBody = body;
              return { status, body };
            },
          };
        },
      } as any;
      await requirePrivileged(request, reply);
      expect(capturedStatus).toBe(401);
    });

    it('returns 403 for a viewer token', async () => {
      const request = makeRequest('Bearer dev-token-viewer') as any;
      let capturedStatus: number | undefined = undefined;
      let capturedBody: any = undefined;
      const reply = {
        code: (status: number) => {
          capturedStatus = status;
          return {
            send: (body: any) => {
              capturedBody = body;
              return { status, body };
            },
          };
        },
      } as any;
      await requirePrivileged(request, reply);
      expect(capturedStatus).toBe(403);
      expect(capturedBody.error).toBe('Forbidden');
    });
  });

describe('verified email eligibility', () => {
    it('accepts Firebase-verified email links and rejects unverified or disposable identities', () => {
      expect(isEligibleFirebaseUserClaims({
        uid: 'verified-user',
        email: 'person@example.org',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      })).toBe(true);
      expect(isEligibleFirebaseUserClaims({
        uid: 'firebase-link-only-user',
        email: 'person@example.org',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      })).toBe(true);
      expect(isEligibleFirebaseUserClaims({
        uid: 'changed-email-user',
        email: 'new@example.org',
        email_verified: true,
        email_code_verified_email: 'old@example.org',
        firebase: { sign_in_provider: 'password' },
      })).toBe(true);
      expect(isEligibleFirebaseUserClaims({
        uid: 'unverified-user',
        email: 'person@example.org',
        email_verified: false,
        firebase: { sign_in_provider: 'password' },
      })).toBe(false);
      expect(isEligibleFirebaseUserClaims({
        uid: 'temp-user',
        email: 'person@mailinator.com',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      })).toBe(false);
      expect(isEligibleFirebaseUserClaims({
        uid: 'bankwen-user',
        email: 'person@bankwen.com',
        email_verified: true,
        firebase: { sign_in_provider: 'password' },
      })).toBe(false);
      expect(isEligibleFirebaseUserClaims({
        uid: 'anonymous-user',
        email: 'person@example.org',
        email_verified: true,
        firebase: { sign_in_provider: 'anonymous' },
      })).toBe(false);
      const previousDomains = process.env.DISPOSABLE_EMAIL_DOMAINS;
      process.env.DISPOSABLE_EMAIL_DOMAINS = 'throwaway.example, disposable.test';
      try {
        expect(isDisposableEmailAddress('person@sub.throwaway.example')).toBe(true);
        expect(isDisposableEmailAddress('person@disposable.test')).toBe(true);
        expect(isDisposableEmailAddress('person@notthrowaway.example')).toBe(false);
      } finally {
        if (previousDomains === undefined) delete process.env.DISPOSABLE_EMAIL_DOMAINS;
        else process.env.DISPOSABLE_EMAIL_DOMAINS = previousDomains;
      }
    });
  });

  describe('verified identities', () => {
    it('defaults unassigned Firebase accounts to read-only viewer and rejects unknown roles', () => {
      expect(buildFirebaseAuthContextFromClaims({ uid: 'user-1', role: 'operator' })?.isPrivileged).toBe(true);
      expect(buildFirebaseAuthContextFromClaims({
        uid: 'new-user',
        email: 'new-user@example.com',
        firebase: { sign_in_provider: 'password' },
      })).toMatchObject({
        userId: 'new-user',
        role: 'viewer',
        isPrivileged: false,
        isViewer: true,
      });
      expect(buildFirebaseAuthContextFromClaims({
        uid: 'firebase-link-only-user',
        email: 'new-user@example.com',
        firebase: { sign_in_provider: 'password' },
      })).toMatchObject({ role: 'viewer', isPrivileged: false, isViewer: true });
      expect(buildFirebaseAuthContextFromClaims({
        uid: 'changed-email-user',
        email: 'new-user@example.com',
        email_code_verified_email: 'old@example.com',
        firebase: { sign_in_provider: 'password' },
      })).toMatchObject({ role: 'viewer', isPrivileged: false, isViewer: true });
      const githubUser = buildFirebaseAuthContextFromClaims({
        uid: 'github-user',
        firebase: { sign_in_provider: 'github.com' },
      });
      expect(githubUser).toMatchObject({
        userId: 'github-user',
        role: 'viewer',
        isPrivileged: false,
        isViewer: true,
      });
      expect(canPerformPrivilegedAction(githubUser!)).toBe(false);
      const googleUser = buildFirebaseAuthContextFromClaims({
        uid: 'google-user',
        firebase: { sign_in_provider: 'google.com' },
      });
      expect(googleUser).toMatchObject({
        userId: 'google-user',
        role: 'viewer',
        isPrivileged: false,
        isViewer: true,
      });
      expect(canPerformPrivilegedAction(googleUser!)).toBe(false);
      expect(buildFirebaseAuthContextFromClaims({
        uid: 'anonymous-user',
        firebase: { sign_in_provider: 'anonymous' },
      })).toBeNull();
      expect(buildFirebaseAuthContextFromClaims({ uid: 'user-2', role: 'unknown' })).toBeNull();
      expect(buildFirebaseAuthContextFromClaims({ uid: 'device-1', role: 'device', deviceId: 'sensoura-esp32-01' })).toBeNull();
      expect(buildFirebaseAuthContextFromClaims({ role: 'admin' })).toBeNull();
    });

    it('binds a long device bearer token to the configured device id', () => {
      const token = 'a'.repeat(40);
      expect(verifyDeviceToken(token, token, 'sensoura-esp32-01')).toMatchObject({
        userId: 'device:sensoura-esp32-01',
        role: 'device',
        authMethod: 'device-bearer',
        deviceId: 'sensoura-esp32-01',
        isPrivileged: false,
      });
      expect(verifyDeviceToken('wrong-token', token, 'sensoura-esp32-01')).toBeNull();
      expect(verifyDeviceToken(token, undefined, 'sensoura-esp32-01')).toBeNull();
      expect(verifyDeviceToken(token, token, 'bad device id')).toBeNull();
    });
  });

  describe('role predicates', () => {
    it('identifies device roles', () => {
      expect(isDeviceRole('device')).toBe(true);
      expect(isDeviceRole('viewer')).toBe(false);
      expect(isDeviceRole(undefined)).toBe(false);
    });

    it('identifies privileged roles', () => {
      expect(isPrivilegedRole('admin')).toBe(true);
      expect(isPrivilegedRole('operator')).toBe(true);
      expect(isPrivilegedRole('viewer')).toBe(false);
      expect(isPrivilegedRole('device')).toBe(false);
      expect(isPrivilegedRole(undefined)).toBe(false);
    });

    it('resolves effective roles from auth objects and raw role values', () => {
      expect(resolveEffectiveRole({ role: 'operator', authMethod: 'dev-token' })).toBe('operator');
      expect(resolveEffectiveRole({ role: 'viewer', authMethod: 'unauthenticated' })).toBe('viewer');
      expect(resolveEffectiveRole('admin')).toBe('admin');
      expect(resolveEffectiveRole('bogus')).toBe('viewer');
      expect(resolveEffectiveRole(undefined)).toBe('viewer');
    });

    it('verifies device identity only for real device auth contexts', () => {
      expect(isDeviceIdentityVerified({ isDevice: true, deviceId: 'dev-device' })).toBe(true);
      expect(isDeviceIdentityVerified({ isDevice: false, deviceId: 'dev-device' })).toBe(false);
      expect(isDeviceIdentityVerified('device')).toBe(false);
      expect(isDeviceIdentityVerified(undefined)).toBe(false);
    });

    it('uses isVerifiedDevice to decide whether a device id is trusted', () => {
      expect(isVerifiedDevice('sensoura-esp32-01')).toBe(true);
      expect(isVerifiedDevice('fake-esp32')).toBe(false);
      expect(isVerifiedDevice(undefined)).toBe(false);
      expect(isVerifiedDevice('')).toBe(false);
    });
  });

  describe('authorization helpers', () => {
    it('grants privileged action to admin and operator roles', () => {
      expect(canPerformPrivilegedAction('admin')).toBe(true);
      expect(canPerformPrivilegedAction('operator')).toBe(true);
    });

    it('denies privileged action to unauthenticated and device identities', () => {
      expect(canPerformPrivilegedAction('viewer')).toBe(false);
      expect(canPerformPrivilegedAction('device')).toBe(false);
      expect(canPerformPrivilegedAction({ role: 'device', isDevice: true, isPrivileged: false } as any)).toBe(false);
      expect(canPerformPrivilegedAction(undefined)).toBe(false);
    });

    it('grants suggestion management to admin and operator roles', () => {
      expect(canManageSuggestions('admin')).toBe(true);
      expect(canManageSuggestions('operator')).toBe(true);
    });

    it('denies suggestion management to unauthenticated identities', () => {
      expect(canManageSuggestions({ role: 'viewer', authMethod: 'unauthenticated' })).toBe(false);
      expect(canManageSuggestions(undefined)).toBe(false);
    });
  });

  describe('socket auth context builder', () => {
    it('builds a device context when a verified device id is supplied', () => {
      const auth = buildSocketAuthContext(undefined, 'sensoura-esp32-01', undefined);
      expect(auth.role).toBe('device');
      expect(auth.authMethod).toBe('device-preconfigured');
      expect(auth.deviceId).toBe('sensoura-esp32-01');
      expect(auth.isDevice).toBe(true);
    });

    it('does not trust a client-supplied viewer role claim on its own', () => {
      const auth = buildSocketAuthContext(undefined, undefined, 'viewer');
      expect(auth.authMethod).toBe('unauthenticated');
      expect(auth.role).toBe('viewer');
    });

    it('falls back to an unauthenticated viewer context when no token is supplied', () => {
      const auth = buildSocketAuthContext(undefined, undefined, undefined);
      expect(auth.authMethod).toBe('unauthenticated');
      expect(auth.role).toBe('viewer');
      expect(auth.isPrivileged).toBe(false);
    });

    it('trusts a verified dev JWT token in the socket auth handshake', () => {
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
  });

  describe('token registry introspection', () => {
    it('exposes the registered dev tokens', () => {
      const registrations = getDevTokenRegistrations();
      const tokens = registrations.map((r) => r.token).sort();
      expect(tokens).toEqual([
        'dev-token',
        'dev-token-admin',
        'dev-token-device',
        'dev-token-viewer',
      ]);
      expect(tokens).toHaveLength(4);
    });
  });

  describe('logging helpers', () => {
    it('redacts empty and very short tokens', () => {
      expect(redactTokenForLogging('')).toBe('<token>');
      expect(redactTokenForLogging('ab')).toBe('<token>');
    });

    it('redacts short dev tokens with head and tail', () => {
      expect(redactTokenForLogging('dev-token')).toBe('dev-…oken');
      expect(redactTokenForLogging('dev-token-abc')).toBe('dev-…-abc');
    });

    it('redacts longer tokens with head and tail', () => {
      expect(redactTokenForLogging('abcdefghij')).toBe('abcd…ghij');
    });
  });
});

// Minimal socket import only so the socket auth context builder coverage stays
// valid without dragging the whole socket module into these unit tests.
import { buildSocketAuthContext } from '../src/services/auth.js';
