import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Some shells inject PORT=0 (or empty) — treat those as "unset" and default to 3000.
  PORT: z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return undefined;
    return n;
  }, z.number().int().min(1).max(65535).default(3000)),
  HOST: z.string().default('127.0.0.1'),

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

  // MQTT (authenticated broker clients; the ESP32 uses the backend HTTPS API)
  MQTT_BROKER_URL: z.string().url().default('mqtt://localhost:1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),

  // AI/ML
  AI_MODEL_PATH: z.string().default('./models'),
  AI_PREDICTION_INTERVAL_MS: z.coerce.number().default(300000), // 5 min
  AI_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.85),

  // Security
  JWT_SECRET: z.string().min(32).optional(),
  // Comma-separated additions to the built-in disposable-email domain blocklist.
  DISPOSABLE_EMAIL_DOMAINS: z.string().optional().default(''),
  DEVICE_ID: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/).default('sensoura-esp32-01'),
  DEVICE_AUTH_TOKEN: z.string().min(32).optional(),
  METRICS_AUTH_TOKEN: z.string().min(32).optional(),
  API_RATE_LIMIT: z.coerce.number().default(100),

  // Optional application log level override. The backend logger defaults to
  // debug in non-production environments and info in production.
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .optional()
    .default('info'),

  // Frontend
  FRONTEND_URL: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080').refine((value) => {
    const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean);
    return origins.length > 0 && origins.every((origin) => {
      try {
        new URL(origin);
        return true;
      } catch {
        return false;
      }
    });
  }, 'FRONTEND_URL must contain one or more valid comma-separated origins'),

  // cPanel SMTP. SMTP_PASS is supplied only through the backend runtime.
  SMTP_HOST: z.string().default('mail.sensoura.ox0x.com'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: z.preprocess((value) => value === undefined ? true : value === true || value === 'true', z.boolean()),
  SMTP_USER: z.string().default('info@sensoura.ox0x.com'),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM_NAME: z.string().trim().min(1).max(120).default('Sensoura'),
  SMTP_FROM_EMAIL: z.string().email().default('info@sensoura.ox0x.com'),
  EMAIL_DEFAULT_LANGUAGE: z.enum(['ar', 'en']).default('en'),
  EMAIL_LOGO_URL: z.string().url().optional(),

  // NASA Competition Metadata
  MISSION_NAME: z.string().default('SENSOURA'),
  MISSION_PHASE: z.string().default('LUNAR_ANALOG'),
  TEAM_ID: z.string().default('TEAM-MISSION-49'),
}).superRefine((config, context) => {
  if (config.NODE_ENV === 'production' && !config.DEVICE_AUTH_TOKEN) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DEVICE_AUTH_TOKEN'],
      message: 'DEVICE_AUTH_TOKEN (at least 32 characters) is required in production',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Environment validation failed:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid backend environment configuration');
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

export const env = getEnv();

const _coercedLogLevel = coerceLogLevel(env.LOG_LEVEL);

export const logLevel = _coercedLogLevel;

// ---------------------------------------------------------------------------
// Runtime configuration (kept separate from the zod schema so the existing
// loadEnv path can continue to grow if needed).
// ---------------------------------------------------------------------------

function coerceLogLevel(input: string | undefined | null): 'debug' | 'info' | 'warn' | 'error' {
  if (input === undefined || input === null) return 'info';
  if (typeof input !== 'string') return 'info';
  const trimmed = input.trim().toLowerCase();
  if (trimmed === 'debug' || trimmed === 'info' || trimmed === 'warn' || trimmed === 'error') {
    return trimmed as 'debug' | 'info' | 'warn' | 'error';
  }
  return 'info';
}
