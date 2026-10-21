import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';
import { initializeApp, cert, type App, type ServiceAccount } from 'firebase-admin/app';
import { getDatabase as fbGetDatabase, type Database } from 'firebase-admin/database';
import { getAuth as fbGetAuth, type Auth } from 'firebase-admin/auth';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = getLogger('firebase');

let app: App | null = null;
let db: Database | null = null;
let auth: Auth | null = null;
let credential: import('firebase-admin/app').Credential | null = null;
let restClient: FirebaseRestClient | null = null;

/**
 * Resolve Firebase credentials from (in priority order):
 * 1. Explicit env vars (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)
 * 2. serviceAccountKey.json (FIREBASE_SERVICE_ACCOUNT_PATH, <cwd>/serviceAccountKey.json,
 *    or the backend project root)
 */
function loadServiceAccount(): ServiceAccount | null {
  const env = getEnv();

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return {
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  const candidates = [
    env.FIREBASE_SERVICE_ACCOUNT_PATH,
    join(process.cwd(), 'serviceAccountKey.json'),
    join(__dirname, '..', '..', 'serviceAccountKey.json'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue;
      const json = JSON.parse(readFileSync(candidate, 'utf-8'));
      if (!json.project_id || !json.client_email || !json.private_key) {
        logger.warn({ path: candidate }, 'serviceAccountKey.json is missing required fields, skipping');
        continue;
      }
      logger.info({ path: candidate, projectId: json.project_id }, 'Loaded service account key file');
      return {
        projectId: json.project_id,
        clientEmail: json.client_email,
        privateKey: String(json.private_key).replace(/\\n/g, '\n'),
      };
    } catch (error) {
      logger.warn({ path: candidate, err: error }, 'Failed to read service account file, trying next candidate');
    }
  }

  return null;
}

export function initializeFirebase(): { app: App; db: Database; auth: Auth } | null {
  const env = getEnv();

  if (app) return { app, db: db!, auth: auth! };

  const serviceAccount = loadServiceAccount();

  if (!serviceAccount) {
    logger.warn('Firebase credentials not configured — running in LOCAL MODE (mock database)');
    return null;
  }

  try {
    credential = cert(serviceAccount);
    app = initializeApp({
      credential,
      databaseURL: env.FIREBASE_DATABASE_URL ?? 'https://on-an-official-team-default-rtdb.europe-west1.firebasedatabase.app',
    });

    db = fbGetDatabase(app);
    auth = fbGetAuth(app);

    const host = (env.FIREBASE_DATABASE_URL ?? app.options.databaseURL ?? '').replace(/^https?:\/\//, '');
    restClient = new FirebaseRestClient(host);

    logger.info({ projectId: serviceAccount.projectId }, 'Firebase Admin SDK initialized');
    return { app, db, auth };
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize Firebase');
    throw error;
  }
}

export function getFirebase() {
  if (!app) {
    const initialized = initializeFirebase();
    if (!initialized) return null;
    return initialized;
  }
  return { app, db: db!, auth: auth! };
}

export function getDatabase(): Database | null {
  return getFirebase()?.db ?? null;
}

export function getAuth(): Auth | null {
  return getFirebase()?.auth ?? null;
}

export function isFirebaseEnabled(): boolean {
  return app !== null;
}

/** REST transport for Firebase RTDB (used as fallback when the SDK's
 *  persistent websocket channel is rejected by the network). */
export class FirebaseRestClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private rootFallback = false;

  constructor(private host: string) {
    if (!host) throw new Error('FirebaseRestClient requires a database host');
  }

  /** Map /Sensoura/* onto the open /testData subtree after a 401. */
  private mapPath(path: string): string {
    if (!this.rootFallback) return path;
    return path.replace(/^\/Sensoura\/?/, '/testData/');
  }

  private maybeDowngrade(path: string): boolean {
    if (!path.startsWith('/Sensoura')) return false;
    if (!this.rootFallback) {
      this.rootFallback = true;
      logger.warn(
        'Firebase rejected the service account on /Sensoura (401). Falling back to /testData '
          + '(the path open for read/write). Grant the service account the "Firebase Realtime Database Admin" '
          + 'role (Console > IAM) to use /Sensoura directly.'
      );
    }
    return true;
  }

  /** True when requests are being redirected to /testData. */
  isUsingTestData(): boolean {
    return this.rootFallback;
  }

  private async authToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    if (!credential) throw new Error('Firebase credential not initialized');
    const token = await credential.getAccessToken();
    this.token = token.access_token;
    this.tokenExpiresAt = Date.now() + (token.expires_in ?? 3600) * 1000;
    return this.token;
  }

  private url(path: string): string {
    return `https://${this.host}/${path.replace(/^\//, '')}.json`;
  }

  async get<T = any>(path: string): Promise<T | null> {
    const token = await this.authToken();
    const mapped = this.mapPath(path);
    const res = await fetch(`${this.url(mapped)}?auth=${token}`, { signal: AbortSignal.timeout(15_000) });
    if ((res.status === 401 || res.status === 403) && this.maybeDowngrade(path)) {
      return this.get<T>(path);
    }
    if (!res.ok) throw new Error(`Firebase REST ${res.status} on GET ${mapped}`);
    const text = await res.text();
    return text === 'null' ? null : (JSON.parse(text) as T);
  }

  async put(path: string, value: unknown): Promise<void> {
    const token = await this.authToken();
    const mapped = this.mapPath(path);
    const res = await fetch(`${this.url(mapped)}?auth=${token}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value ?? null),
      signal: AbortSignal.timeout(15_000),
    });
    if ((res.status === 401 || res.status === 403) && this.maybeDowngrade(path)) {
      return this.put(path, value);
    }
    if (!res.ok) throw new Error(`Firebase REST ${res.status} on PUT ${mapped}`);
  }

  async update(path: string, value: Record<string, unknown>): Promise<void> {
    const current = (await this.get<Record<string, unknown>>(path)) ?? {};
    await this.put(path, { ...current, ...value });
  }
}

export function getRestClient(): FirebaseRestClient | null {
  return restClient;
}

// Mock database for local development
export class MockDatabase {
  private data: Map<string, any> = new Map();
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  ref(path: string) {
    return new MockReference(this, path);
  }

  get(path: string) {
    const keys = path.split('/').filter(Boolean);
    let current: any = Object.fromEntries(this.data);
    for (const key of keys) {
      current = current?.[key];
    }
    return Promise.resolve({ val: () => current, exists: () => current !== undefined });
  }

  set(path: string, value: any) {
    const keys = path.split('/').filter(Boolean);
    let current = Object.fromEntries(this.data);
    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = current[keys[i]] ?? {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    this.notify(path, value);
    return Promise.resolve();
  }

  update(path: string, value: any) {
    return this.get(path).then(snap => {
      const current = snap.val() ?? {};
      return this.set(path, { ...current, ...value });
    });
  }

  on(path: string, event: 'value' | 'child_added' | 'child_changed' | 'child_removed', callback: (snap: any) => void) {
    if (!this.listeners.has(path)) this.listeners.set(path, new Set());
    this.listeners.get(path)!.add(callback);
    // Immediate callback with current data
    this.get(path).then(snap => callback(snap));
    return () => this.off(path, callback);
  }

  off(path: string, callback: (snap: any) => void) {
    this.listeners.get(path)?.delete(callback);
  }

  private notify(path: string, value: any) {
    const snap = { val: () => value, exists: () => value !== undefined, key: path.split('/').pop() };
    this.listeners.get(path)?.forEach(cb => cb(snap));
  }
}

class MockReference {
  constructor(private db: MockDatabase, private path: string) {}

  set(value: any) { return this.db.set(this.path, value); }
  update(value: any) { return this.db.update(this.path, value); }
  get() { return this.db.get(this.path); }
  on(event: string, callback: (snap: any) => void) { return this.db.on(this.path, event as any, callback); }
  off(event: string, callback: (snap: any) => void) { this.db.off(this.path, callback); }
  push() { const key = `mock_${Date.now()}_${Math.random().toString(36).slice(2)}`; return new MockReference(this.db, `${this.path}/${key}`); }
  child(key: string) { return new MockReference(this.db, `${this.path}/${key}`); }
}

export const mockDb = new MockDatabase();

// Initialize mock data for development
if (!isFirebaseEnabled()) {
  mockDb.set('/Sensoura', {
    sensorData: {
      temperature: 28.4,
      soilTemperature: 22.5,
      humidity: 65.0,
      soilMoisture: 24.0,
      gas: 185,
      light: 720,
      airPressure: 1013.25,
      lastUpdate: Date.now(),
    },
    system: {
      status: 'online',
      lastSeen: Date.now(),
      deviceId: 'sensoura-esp32-01',
      relay: { mode: 'AUTO', state: 'ON', reason: 'soil_dry', lastAction: Date.now() },
      buzzer: { muted: false },
      leds: { green: false, red: true },
    },
    commands: {},
    commandResults: {},
    aiSuggestions: {},
  });
  logger.info('Mock database initialized with Sensoura sample data');
}