import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fastifyCors } from '@fastify/cors';
import { fastifyHelmet } from '@fastify/helmet';
import { fastifyRateLimit } from '@fastify/rate-limit';
import { fastifyCompress } from '@fastify/compress';
import { getEnv } from './config/env.js';
import { getLogger } from './utils/logger.js';
import { initializeFirebase, isFirebaseEnabled } from './services/firebase.js';
import { realtimeService } from './services/realtime.js';
import { initializeSocketIO } from './socket/index.js';
import { registerRoutes } from './routes/index.js';
import { registerClimateRoutes } from './routes/climate.js';
import { aiEngine } from './ai/engine.js';

const env = getEnv();
const frontendOrigins = env.FRONTEND_URL.split(',').map((origin) => origin.trim()).filter(Boolean);
const logger = getLogger('main');

// Frontend build location: backend/public
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(currentDir, '../public');
const frontendIndexPath = path.join(frontendRoot, 'index.html');

async function buildApp() {
  const app = Fastify({
    logger: false,
    ajv: { customOptions: { removeAdditional: 'all' } },
  });

  // Security & performance plugins
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(fastifyCors, {
    origin: frontendOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyRateLimit, {
    max: env.API_RATE_LIMIT,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  await app.register(fastifyCompress, { global: true });

  // Initialize services
  logger.info('Initializing services...');

  initializeFirebase();

  await aiEngine.initialize();
  await realtimeService.startListening();

  // API Routes
  await registerRoutes(app);
  await registerClimateRoutes(app);

  // Serve the frontend build if available
  if (existsSync(frontendIndexPath)) {
    await app.register(fastifyStatic, {
      root: frontendRoot,
      prefix: '/',
      index: false,
    });

    logger.info({ frontendRoot }, 'Frontend static files registered');
  } else {
    logger.warn({ frontendRoot }, 'Frontend build not found; API-only mode');
  }

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error({ err: error, url: request.url }, 'Unhandled error');

    const statusCode = error.statusCode || 500;

    reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal Server Error' : error.message,
      ...(env.NODE_ENV === 'development' && { stack: error.stack }),
    });
  });

  // 404 handler + React Router fallback
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] || '/';

    const isReservedPath =
      pathname === '/api' ||
      pathname.startsWith('/api/') ||
      pathname === '/socket.io' ||
      pathname.startsWith('/socket.io/') ||
      ['/health', '/ready', '/metrics'].includes(pathname);

    const acceptsHtml =
      request.method === 'GET' &&
      (request.headers.accept ?? '').includes('text/html');

    if (
      existsSync(frontendIndexPath) &&
      acceptsHtml &&
      !isReservedPath
    ) {
      return reply.type('text/html').sendFile('index.html');
    }

    return reply.code(404).send({
      error: 'Not Found',
      path: request.url,
    });
  });

  return app;
}

async function start() {
  try {
    const app = await buildApp();

    // Attach Socket.IO to Fastify's HTTP server
    const io = initializeSocketIO(app.server, frontendOrigins);
    app.decorate('io', io);

    await app.listen({ port: env.PORT, host: env.HOST });

    logger.info({
      port: env.PORT,
      host: env.HOST,
      env: env.NODE_ENV,
      mission: env.MISSION_NAME,
      firebase: isFirebaseEnabled() ? 'sdk' : 'mock',
    }, '🚀 SENSOURA Backend started');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down...');
      realtimeService.stopListening();
      io.close();
      await app.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (error) => {
      logger.fatal({ err: error }, 'Uncaught exception');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      logger.fatal({ reason }, 'Unhandled rejection');
      process.exit(1);
    });

  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    io: import('socket.io').Server;
  }
}

start();