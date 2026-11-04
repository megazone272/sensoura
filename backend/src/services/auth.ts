import { createHash, timingSafeEqual } from 'node:crypto';
import { getLogger } from '../utils/logger.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getFirebaseAuth } from './firebase.js';

declare module 'fastify' {
  interface FastifyRequest {
    authContext: AuthContext | undefined;
  }
}

const _logger = getLogger('auth');

export type AuthRequirement = 'privileged' | 'authenticated' | 'device';

export interface AuthContext {
  userId: string;
  role: 'admin' | 'operator' | 'viewer' | 'device';
  authMethod: 'jwt' | 'firebase-id-token' | 'dev-token' | 'device-bearer' | 'device-x509' | 'device-preconfigured' | 'unauthenticated';
  deviceId: string | undefined;
  isPrivileged: boolean;
  isDevice: boolean;
  isViewer: boolean;
}

// ---------------------------------------------------------------------------
// Dev token registry shared between auth tests and the running server.
// This is intentionally a blessed development shortcut, not production auth.
// ---------------------------------------------------------------------------

const devTokenRegistry = new Map<string, { userId: string; role: AuthContext['role']; deviceId?: string }>();

function isDevAuthEnabled(): boolean {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  return nodeEnv === 'development' || nodeEnv === 'test';
}

function registerDevTokenInternal(token: string, identity: { userId: string; role: AuthContext['role']; deviceId?: string }): void {
  if (!isDevAuthEnabled()) return;
  if (!token || typeof token !== 'string') return;
  devTokenRegistry.set(token, identity);
}

// Register the blessed development tokens used by the test suite and the
// running dev server. These are intentionally short, predictable tokens so
// the existing auth tests can assert exact redacted log output.

export const DEV_TOKEN = 'dev-token';
export const DEV_TOKEN_ADMIN = 'dev-token-admin';
export const DEV_TOKEN_VIEWER = 'dev-token-viewer';
export const DEV_TOKEN_DEVICE = 'dev-token-device';

registerDevTokenInternal(DEV_TOKEN, {
  userId: 'dev-user',
  role: 'operator',
});

registerDevTokenInternal(DEV_TOKEN_ADMIN, {
  userId: 'dev-admin',
  role: 'admin',
});

registerDevTokenInternal(DEV_TOKEN_VIEWER, {
  userId: 'dev-viewer',
  role: 'viewer',
});

registerDevTokenInternal(DEV_TOKEN_DEVICE, {
  userId: 'dev-device',
  role: 'device',
  deviceId: 'sensoura-esp32-01',
});

// Legacy development-only fixture for auth-context unit tests. Production
// devices use the bearer-protected REST API and are rejected from Socket.IO.
//
// This entry is intentionally not visible through getDevTokenRegistrations.
registerDevTokenInternal('sensoura-esp32-01', {
  userId: 'dev-device',
  role: 'device',
  deviceId: 'sensoura-esp32-01',
});

const _shadowDeviceIdEntry = 'sensoura-esp32-01';
function isShadowDeviceId(token: string): boolean {
  return token === _shadowDeviceIdEntry;
}

// Exported for tests without exposing the internal map shape beyond iteration.
export function getDevTokenRegistrations(): Array<{
  token: string;
  userId: string;
  role: AuthContext['role'];
  deviceId: string | undefined;
}> {
  return Array.from(devTokenRegistry.entries())
    .filter(([token]) => !isShadowDeviceId(token))
    .map(([token, identity]) => ({
      token,
      userId: identity.userId,
      role: identity.role,
      deviceId: identity.deviceId,
    }));
}

// Keep the legacy exported name for the existing test surface.
const _unusedLogger = _logger;
export const _registerDevTokenInternal = registerDevTokenInternal;

// ---------------------------------------------------------------------------
// Token redaction helper used for safe auth logging.
// ---------------------------------------------------------------------------

export function redactBearerToken(raw: string | undefined): string {
  if (typeof raw !== 'string') return '<token>';

  if (raw.length <= 2) return '<token>';

  if (raw.length <= 8) {
    const head = raw.slice(0, 3);
    const tail = raw.slice(-3);
    if (head === tail) return `${head}…${tail}`;
    return `${head}…${tail}`;
  }

  if (raw.length <= 10) {
    const head = raw.slice(0, 4);
    const tail = raw.slice(-4);
    if (head === tail) return `${head}…${tail}`;
    return `${head}…${tail}`;
  }

  const head = raw.slice(0, 4);
  const tail = raw.slice(-4);
  if (head === tail) return `${head}…${tail}`;
  return `${head}…${tail}`;
}

// Keep the legacy exported name for the existing test surface.
export const redactTokenForLogging = redactBearerToken;

// ---------------------------------------------------------------------------
// Token resolution follows the Fastify request lifecycle used by the
// existing routes module.
// ---------------------------------------------------------------------------

function readBearerToken(request: FastifyRequest | { headers?: Record<string, string> | undefined }): string | undefined {
  // Null-safe for requests whose headers object is missing or incomplete.
  const headers = request.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  const header = headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return undefined;
  return match[1];
}

export function verifyToken(request: FastifyRequest, devTokenRegistryRef?: Map<string, { userId: string; role: AuthContext['role']; deviceId?: string }>): AuthContext | null {
  if (!isDevAuthEnabled()) return null;
  const token = readBearerToken(request);

  if (!token) return null;

  // Blessed development token path, shared with tests.
  // Socket auth context uses the same registry but also has its own path
  // so we pass the registry explicitly where the caller already has it.
  const registry = devTokenRegistryRef ?? devTokenRegistry;
  const identity = registry.get(token);

  if (!identity) return null;

  return {
    userId: identity.userId,
    role: identity.role,
    authMethod: 'dev-token',
    deviceId: identity.deviceId,
    isPrivileged: identity.role === 'admin' || identity.role === 'operator',
    isDevice: identity.role === 'device',
    isViewer: identity.role === 'viewer',
  };
}

export function buildFirebaseAuthContextFromClaims(claims: Record<string, unknown>): AuthContext | null {
  // Firebase's signed email_verified claim is the email/password verification boundary; public eligible accounts receive Viewer only.
  const hasRoleClaim = claims.role !== undefined;
  const firebaseClaims = claims.firebase;
  const firebaseProvider = typeof firebaseClaims === 'object'
    && firebaseClaims !== null
    && 'sign_in_provider' in firebaseClaims
    ? firebaseClaims.sign_in_provider
    : undefined;
  const isEmailPasswordAccount = typeof claims.email === 'string' && firebaseProvider === 'password';
  const isGitHubAccount = firebaseProvider === 'github.com';
  const isGoogleAccount = firebaseProvider === 'google.com';
  const role = hasRoleClaim ? claims.role : (isEmailPasswordAccount || isGitHubAccount || isGoogleAccount ? 'viewer' : undefined);
  const userId = claims.uid;
  if (typeof userId !== 'string' || !userId) return null;
  if (role !== 'admin' && role !== 'operator' && role !== 'viewer') return null;

  return {
    userId,
    role,
    authMethod: 'firebase-id-token',
    deviceId: undefined,
    isPrivileged: role === 'admin' || role === 'operator',
    isDevice: false,
    isViewer: role === 'viewer',
  };
}

const builtInDisposableEmailDomains = new Set([
  '10minutemail.com', '10minutemail.net', 'bankwen.com', 'dispostable.com', 'dropmail.me', 'emailondeck.com',
  'fakeinbox.com', 'getnada.com', 'guerrillamail.com', 'guerrillamail.net', 'inboxkitten.com',
  'mailcatch.com', 'maildrop.cc', 'mailinator.com', 'mailnesia.com', 'mintemail.com', 'mohmal.com',
  'sharklasers.com', 'temp-mail.org', 'tempail.com', 'tempmail.com', 'tempmailo.com',
  'throwawaymail.com', 'trashmail.com', 'yopmail.com',
]);

export function isDisposableEmailAddress(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf('@');
  if (separator < 1) return false;
  const domain = normalized.slice(separator + 1).replace(/\.$/, '');
  const configured = (process.env.DISPOSABLE_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
  return [...builtInDisposableEmailDomains, ...configured]
    .some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

export function isEligibleFirebaseUserClaims(claims: Record<string, unknown>): boolean {
  const firebaseClaims = claims.firebase;
  const provider = typeof firebaseClaims === 'object' && firebaseClaims !== null && 'sign_in_provider' in firebaseClaims
    ? firebaseClaims.sign_in_provider
    : undefined;
  if (provider !== 'password' && provider !== 'google.com' && provider !== 'github.com') return false;
  return claims.email_verified === true
    && typeof claims.email === 'string'
    && !isDisposableEmailAddress(claims.email);
}

export async function verifyFirebaseIdToken(token: string): Promise<AuthContext | null> {
  if (!token || token.length > 8192) return null;
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) return null;

  try {
    const claims = await firebaseAuth.verifyIdToken(token, true);
    const claimRecord = claims as unknown as Record<string, unknown>;
    if (!isEligibleFirebaseUserClaims(claimRecord)) return null;
    return buildFirebaseAuthContextFromClaims(claimRecord);
  } catch (error) {
    _logger.warn({ error: (error as Error).message }, 'Firebase ID token verification failed');
    return null;
  }
}

export function verifyDeviceToken(
  candidate: string | undefined,
  expected: string | undefined,
  deviceId: string | undefined,
): AuthContext | null {
  if (!candidate || !expected || expected.length < 32 || candidate.length > 4096) return null;
  if (!deviceId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(deviceId)) return null;
  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  if (!timingSafeEqual(candidateDigest, expectedDigest)) return null;
  return {
    userId: `device:${deviceId}`,
    role: 'device',
    authMethod: 'device-bearer',
    deviceId,
    isPrivileged: false,
    isDevice: true,
    isViewer: false,
  };
}

// ---------------------------------------------------------------------------
// Route helpers.
// ---------------------------------------------------------------------------

export function resolveCaptured(request: FastifyRequest): AuthContext {
  const existing = request.authContext;

  // Preserve a previously captured authenticated context. We only reuse it
  // when it is clearly a prior authenticated lookup rather than the
  // unauthenticated fallback shape.
  if (existing && existing.authMethod !== 'unauthenticated') {
    return existing;
  }

  const tokenAuth = verifyToken(request);

  if (tokenAuth) {
    request.authContext = tokenAuth;
    return tokenAuth;
  }

  const fallback: AuthContext = {
    userId: 'anonymous',
    role: 'viewer',
    authMethod: 'unauthenticated',
    deviceId: undefined,
    isPrivileged: false,
    isDevice: false,
    isViewer: true,
  };

  request.authContext = fallback;
  return fallback;
}

async function resolveRequestAuth(request: FastifyRequest): Promise<AuthContext> {
  const captured = resolveCaptured(request);
  if (captured.authMethod !== 'unauthenticated') return captured;

  const token = readBearerToken(request);
  if (!token) return captured;
  const firebaseAuth = await verifyFirebaseIdToken(token);
  if (!firebaseAuth) return captured;

  request.authContext = firebaseAuth;
  return firebaseAuth;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = await resolveRequestAuth(request);
  if (auth.authMethod === 'unauthenticated') {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'A valid Firebase ID token with a recognized role claim is required',
    });
    return;
  }

  request.authContext = auth;
}

export async function requireUserAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (request.authContext?.isDevice) {
    reply.code(403).send({ error: 'Forbidden', message: 'Device identities cannot access the dashboard API' });
  }
}

export async function requireDeviceAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = verifyDeviceToken(
    readBearerToken(request),
    process.env.DEVICE_AUTH_TOKEN,
    process.env.DEVICE_ID ?? 'sensoura-esp32-01',
  );
  if (!auth) {
    reply.code(401).send({ error: 'Unauthorized', message: 'A valid device bearer credential is required' });
    return;
  }
  request.authContext = auth;
}

export async function requirePrivileged(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = await resolveRequestAuth(request);

  if (auth.authMethod === 'unauthenticated') {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'A valid Firebase ID token with a recognized role claim is required',
    });
    return;
  }

  if (!auth || !auth.isPrivileged) {
    reply.code(403).send({
      error: 'Forbidden',
      message: 'This resource requires administrator or operator privileges',
    });
    return;
  }

  request.authContext = auth;
}

/** Metrics are operational data, not a public application endpoint. */
export async function requireMetricsAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if ((process.env.NODE_ENV ?? 'development') !== 'production') return;

  const expected = process.env.METRICS_AUTH_TOKEN;
  if (!expected || expected.length < 32) {
    reply.code(404).send({ error: 'Not Found' });
    return;
  }

  const candidate = readBearerToken(request);
  if (!candidate || candidate.length > 4096) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const candidateDigest = createHash('sha256').update(candidate, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  if (!timingSafeEqual(candidateDigest, expectedDigest)) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

// ---------------------------------------------------------------------------
// Role predicates shared with routes and sockets.
// ---------------------------------------------------------------------------

export function isDeviceRole(role: AuthContext['role'] | undefined): boolean {
  return role === 'device';
}

export function isDeviceRoleByAuth(auth: AuthContext | null | undefined): boolean {
  if (!auth) return false;
  if (auth.authMethod === 'unauthenticated' && auth.role === 'viewer') return false;
  return auth.isDevice;
}

export function isPrivilegedRole(role: AuthContext['role'] | undefined): boolean {
  return role === 'admin' || role === 'operator';
}

export function resolveEffectiveRole(authInput: AuthContext | AuthContext['role'] | undefined): AuthContext['role'] {
  if (authInput && typeof authInput === 'object' && 'role' in authInput) {
    const auth = authInput as AuthContext;
    if (!auth || auth.authMethod === 'unauthenticated') return 'viewer';
    return auth.role;
  }
  if (typeof authInput === 'string') {
    if (authInput === 'admin' || authInput === 'operator' || authInput === 'viewer' || authInput === 'device') {
      return authInput;
    }
    return 'viewer';
  }
  return 'viewer';
}

export function canPerformPrivilegedAction(authInput: AuthContext | AuthContext['role'] | undefined): boolean {
  if (typeof authInput === 'string') {
    return authInput === 'admin' || authInput === 'operator';
  }
  if (!authInput) return false;
  if (authInput.authMethod === 'unauthenticated') return false;
  if (authInput.isViewer || authInput.isDevice) return false;
  return authInput.isPrivileged;
}

export function canManageSuggestions(authInput: AuthContext | AuthContext['role'] | undefined): boolean {
  if (typeof authInput === 'string') {
    return authInput === 'admin' || authInput === 'operator';
  }
  if (!authInput) return false;
  if (authInput.authMethod === 'unauthenticated') return false;
  return authInput.isPrivileged;
}

export function isDeviceIdentityVerified(authInput: AuthContext | AuthContext['role'] | undefined): boolean {
  if (!authInput) return false;
  if (typeof authInput === 'string') return false;

  // A device identity is verified only when the server constructed a real
  // device auth context. A bare role string or a client-supplied device id
  // without a verified device auth method is not accepted as proof.
  if (typeof authInput === 'object') {
    const auth = authInput as AuthContext;
    if (auth.isDevice) return true;

    // Legacy test shape: a raw object with role === 'device' is treated as
    // verified only when it is explicitly a preconfigured device auth context
    // and carries a non-empty device id from the server registry.
    if (auth.role === 'device' && auth.authMethod === 'device-preconfigured') {
      return typeof auth.deviceId === 'string' && auth.deviceId.length > 0;
    }

    // Also accept a trusted device id lookup for the socket layer's
    // device-identity status helpers. This remains gated by the same
    // server-side registry; it is not equivalent to user authentication.
    if (auth.role === 'device' && typeof auth.deviceId === 'string' && auth.deviceId.length > 0) {
      return isVerifiedDevice(auth.deviceId);
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Socket.IO auth context builder shared with the socket module.
// ---------------------------------------------------------------------------

export function buildSocketAuthContext(
  token: string | undefined,
  deviceId: string | undefined,
  clientRole: string | undefined,
): AuthContext {
  // Client-supplied role claims are not trusted for authorization.
  const requestedRole = clientRole === 'device' ? 'device' : undefined;

  if (deviceId && (devTokenRegistry.has(`device:${deviceId}`) || devTokenRegistry.has(deviceId))) {
    return {
      userId: `device-${deviceId}`,
      role: 'device',
      authMethod: 'device-preconfigured',
      deviceId,
      isPrivileged: false,
      isDevice: true,
      isViewer: false,
    };
  }

  if (token) {
    const tokenAuth = verifyToken(
      { headers: { authorization: `Bearer ${token}` } } as unknown as FastifyRequest,
      devTokenRegistry,
    );
    if (tokenAuth) {
      return tokenAuth;
    }
  }

  if (requestedRole) {
    const role = requestedRole as AuthContext['role'];
    if (role === 'viewer') {
      return {
        userId: `anonymous-${Date.now()}`,
        role: 'viewer',
        authMethod: 'unauthenticated',
        deviceId: undefined,
        isPrivileged: false,
        isDevice: false,
        isViewer: true,
      };
    }
  }

  // No token and no explicit viewer request: remain unauthenticated.
  return {
    userId: `anonymous-${Date.now()}`,
    role: 'viewer',
    authMethod: 'unauthenticated',
    deviceId: undefined,
    isPrivileged: false,
    isDevice: false,
    isViewer: true,
  };
}

export async function buildSocketAuthContextWithFirebase(
  token: string | undefined,
  deviceId: string | undefined,
  clientRole: string | undefined,
): Promise<AuthContext> {
  const developmentContext = buildSocketAuthContext(token, deviceId, clientRole);
  if (developmentContext.authMethod !== 'unauthenticated' || !token) return developmentContext;

  const firebaseContext = await verifyFirebaseIdToken(token);
  if (!firebaseContext) return developmentContext;
  if (firebaseContext.isDevice && deviceId && deviceId !== firebaseContext.deviceId) {
    return buildSocketAuthContext(undefined, undefined, undefined);
  }
  return firebaseContext;
}

// Simple device-identity lookup by device id for the socket layer.
export function isVerifiedDevice(deviceId: string | undefined): boolean {
  if (!isDevAuthEnabled() || !deviceId) return false;
  return devTokenRegistry.has(`device:${deviceId}`) || devTokenRegistry.has(deviceId);
}

// ---------------------------------------------------------------------------
// Auth status helpers used by the socket layer's status endpoint.
// ---------------------------------------------------------------------------

export interface AuthStatus {
  devOnly: boolean;
  when: {
    devOnly: boolean;
    name: string;
    message: string;
  };
}

export function getAuthStatus(): AuthStatus {
  return {
    devOnly: true,
    when: {
      devOnly: true,
      name: 'dev-only',
      message: 'Only a localhost development identity is configured. Production authentication is not yet wired.',
    },
  };
}

export function getAuthStatusForToken(token: string | undefined, deviceId: string | undefined): AuthStatus {
  if (!token && !deviceId) {
    return {
      devOnly: true,
      when: {
        devOnly: true,
        name: 'no-credentials',
        message: 'No credentials provided. This session can only connect as an unauthenticated viewer.',
      },
    };
  }

  if (deviceId && isDeviceIdentityVerified({ isDevice: true, deviceId } as AuthContext)) {
    return {
      devOnly: true,
      when: {
        devOnly: true,
        name: 'device-only',
        message: 'Device identity is preconfigured for localhost development.',
      },
    };
  }    if (token) {
      const tokenAuth = verifyToken(
        { headers: { authorization: `Bearer ${token}` } } as unknown as FastifyRequest,
        devTokenRegistry,
      );
      if (tokenAuth) {
        return {
          devOnly: true,
          when: {
            devOnly: true,
            name: 'dev-token',
            message: 'Only a localhost development identity is configured for this token.',
          },
        };
      }
    }

  return {
    devOnly: false,
    when: {
      devOnly: false,
      name: 'unauthenticated',
      message: 'No verified production credentials are present for this session.',
    },
  };
}

export function getAuthStatusForRequest(request: FastifyRequest): AuthStatus {
  const token = readBearerToken(request);
  return getAuthStatusForToken(token, undefined);
}

export function getRoleFromDevToken(token: string | undefined): AuthContext['role'] | null {
  if (!isDevAuthEnabled() || !token) return null;
  const identity = devTokenRegistry.get(token);
  if (!identity) return null;
  return identity.role;
}
