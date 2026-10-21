import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Some shells inject PORT=0 (or empty) — treat those as "unset" and default to 3000.
  PORT: z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return undefined;
    return n;
  }, z.number().int().min(1).max(65535).default(3000)),
  HOST: z.string().default('0.0.0.0'),

  // Firebase (optional for local dev)
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_DATABASE_URL: z.string().url().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  // Redis (for BullMQ job queue)
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // MQTT (for ESP32 direct communication)
  MQTT_BROKER_URL: z.string().url().default('mqtt://localhost:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),

  // AI/ML
  AI_MODEL_PATH: z.string().default('./models'),
  AI_PREDICTION_INTERVAL_MS: z.coerce.number().default(300000), // 5 min
  AI_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.85),

  // Security
  JWT_SECRET: z.string().min(32).optional(),
  API_RATE_LIMIT: z.coerce.number().default(100),

  // Frontend
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  // NASA Competition Metadata
  MISSION_NAME: z.string().default('SENSOURA'),
  MISSION_PHASE: z.string().default('LUNAR_ANALOG'),
  TEAM_ID: z.string().default('TEAM-MISSION-49'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.warn('⚠️  Environment validation warnings:', parsed.error.flatten().fieldErrors);
  }
  cachedEnv = parsed.data ?? envSchema.parse({});
  return cachedEnv;
}

export const env = getEnv();