import { getLogger } from '../utils/logger.js';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth, type Auth as FirebaseAuth } from 'firebase-admin/auth';
import { getDatabase as getAdminDatabase } from 'firebase-admin/database';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const logger = getLogger('firebase');

export function findServiceAccountKey(keyPath?: string): string | null {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates: (string | undefined)[] = [
    keyPath,
    keyPath ? path.resolve(process.cwd(), keyPath) : undefined,
    keyPath ? path.resolve(process.cwd(), 'backend', keyPath) : undefined,
    keyPath ? path.resolve(currentDir, '..', '..', keyPath) : undefined,
    path.resolve(process.cwd(), 'serviceAccountKey.json'),
    path.resolve(process.cwd(), 'backend', 'serviceAccountKey.json'),
    path.resolve(currentDir, '../../serviceAccountKey.json'),
    path.resolve(process.cwd(), 'backend', 'on-an-official-team-firebase-adminsdk-fbsvc-44374138e1.json'),
    'C:/Users/nour/secrets/sensoura-firebase-admin.json',
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      try {
        const content = JSON.parse(readFileSync(candidate, 'utf8'));
        if (content && (content.project_id || content.client_email)) {
          return candidate;
        }
      } catch {
        // Continue searching
      }
    }
  }
  return null;
}

export type FirebaseCredentials =
  | { type: 'env'; projectId: string; clientEmail: string }
  | { type: 'keyfile'; projectId: string; path: string }
  | { type: 'adc' };

interface NormalizedCredentials {
  projectId: string;
  source: string;
}

export function resolveCredentials(): NormalizedCredentials | null {
  const resolvedKey = findServiceAccountKey(process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
  let keyProjectId: string | undefined;
  if (resolvedKey) {
    try {
      keyProjectId = JSON.parse(readFileSync(resolvedKey, 'utf8')).project_id;
    } catch {
      // ignore
    }
  }
  const projectId = process.env.FIREBASE_PROJECT_ID ?? keyProjectId;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (projectId && clientEmail && !resolvedKey) {
    logger.info({ projectId }, 'Using env-based Firebase credentials (clientEmail configured, no key path)');
    return { projectId, source: 'env' };
  }

  if (projectId && resolvedKey) {
    logger.info({ projectId, keyPath: resolvedKey }, 'Using Firebase service account key path');
    return { projectId, source: 'keyfile' };
  }

  if (projectId) {
    logger.info({ projectId }, 'Firebase project configured; relying on Application Default Credentials');
    return { projectId, source: 'adc' };
  }

  logger.warn('No Firebase project configured; Firebase-dependent features will be unavailable');
  return null;
}

export function describeCredentials(creds: NormalizedCredentials | null): string {
  if (!creds) return 'unconfigured';
  return `${creds.source} (project ${creds.projectId})`;
}

export function isCredentialUsable(creds: NormalizedCredentials | null): boolean {
  if (!creds) return false;
  if (creds.source === 'env') {
    return Boolean(process.env.FIREBASE_PRIVATE_KEY);
  }
  if (creds.source === 'keyfile') {
    return Boolean(findServiceAccountKey(process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH));
  }
  return true;
}

// --- Runtime Firebase wiring ---

let _initialized = false;
let _enabled = false;

// Firebase Admin is the only configured database transport. Nonproduction
// runs without credentials use the in-memory mock; production fails closed.

let _db: import('firebase-admin/database').Database | null = null;
let _auth: FirebaseAuth | null = null;

/**
 * Initialize the Firebase SDK when usable credentials are present.
 * When credentials are absent the application continues in local/mock mode;
 * no credential values are logged and no key material is created here.
 */
export function initializeFirebase(): void {
  if (_initialized) return;
  _initialized = true;

  const creds = resolveCredentials();
  _enabled = isCredentialUsable(creds);

  if (!_enabled) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Firebase Admin credentials are required in production');
    }
    logger.info('Running in LOCAL MODE (mock database)');
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID ?? creds?.projectId;
  const databaseURL = process.env.FIREBASE_DATABASE_URL ?? 'https://on-an-official-team-default-rtdb.europe-west1.firebasedatabase.app';
  if (!projectId || !databaseURL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FIREBASE_PROJECT_ID and FIREBASE_DATABASE_URL are required in production');
    }
    _enabled = false;
    logger.warn('Firebase project or database URL is incomplete; using LOCAL MODE');
    return;
  }

  try {
    const resolvedKey = findServiceAccountKey(process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
    let credential;
    if (resolvedKey) {
      const serviceAccount = JSON.parse(readFileSync(resolvedKey, 'utf8'));
      credential = cert(serviceAccount);
    } else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      credential = cert({
        projectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else {
      credential = applicationDefault();
    }

    const app = getApps().find((candidate) => candidate.name === 'sensoura')
      ?? initializeApp({ credential, projectId, databaseURL }, 'sensoura');
    _db = getAdminDatabase(app);
    _auth = getAdminAuth(app);
    _enabled = true;
    logger.info({ projectId }, 'Firebase Admin SDK initialized');
  } catch (error) {
    _enabled = false;
    _db = null;
    _auth = null;
    logger.error({ error: (error as Error).message }, 'Firebase Admin initialization failed');
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Firebase Admin initialization failed; production startup aborted');
    }
  }
}

export function isFirebaseEnabled(): boolean {
  return _enabled;
}

export function getDatabase(): import('firebase-admin/database').Database | null {
  return _db;
}

export function getFirebaseAuth(): FirebaseAuth | null {
  return _auth;
}

// --- Legacy compatibility aliases (do not add new callers) ---
export type FirebaseCredentialsFromEnv =
  | { type: 'env'; projectId: string; clientEmail: string }
  | { type: 'keyfile'; projectId: string; path: string }
  | { type: 'adc' };

export type NormalizedCredentialsFromEnv = NormalizedCredentials;

export function loadCredentials(): NormalizedCredentials | null {
  return resolveCredentials();
}

export function describe(creds: NormalizedCredentials | null): string {
  return describeCredentials(creds);
}

export function usable(creds: NormalizedCredentials | null): boolean {
  return isCredentialUsable(creds);
}

// --- Mock database used only when Firebase is not configured ---
// This mirrors the mock path already referenced by push-schema.ts so the two
// offline paths stay coherent. It is intentionally minimal and not a real
// Firebase SDK.

declare global {
  var __sensouraMockDb: Record<string, unknown> | undefined;
}

interface MockRef {
  get(): { exists: () => boolean; val: () => unknown };
}

function mockRef(_path: string): MockRef {
  return {
    get() {
      return {
        exists: () => false,
        val: () => null,
      };
    },
  };
}

export const mockDb: {
  get: (path: string) => unknown;
  set: (path: string, value: unknown) => void;
  ref: (path: string) => MockRef;
} = {
  get(_path: string) {
    return globalThis.__sensouraMockDb ?? null;
  },
  set(_path: string, value: unknown) {
    globalThis.__sensouraMockDb = value as Record<string, unknown>;
  },
  ref(_path: string) {
    return mockRef(_path);
  },
};
