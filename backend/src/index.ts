import Fastify from 'fastify';
import { fastifyCors } from '@fastify/cors';
import { fastifyHelmet } from '@fastify/helmet';
import { fastifyRateLimit } from '@fastify/rate-limit';
import { fastifyCompress } from '@fastify/compress';
import { getEnv } from './config/env.js';
import { getLogger } from './utils/logger.js';
import { initializeFirebase } from './services/firebase.js';
import { realtimeService } from './services/realtime.js';
import { initializeSocketIO } from './socket/index.js';
import { registerRoutes } from './routes/index.js';
import { aiEngine } from './ai/engine.js';

const env = getEnv();
const logger = getLogger('main');

async function buildApp() {
  const app = Fastify({
    logger: false, // We use our own pino logger
    ajv: { customOptions: { removeAdditional: 'all' } },
  });

  // Security & performance plugins
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // Allow Socket.IO
    crossOriginEmbedderPolicy: false,
  });

  await app.register(fastifyCors, {
    origin: env.FRONTEND_URL,
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

  // Firebase (optional - runs in mock mode if not configured)
  initializeFirebase();

  // AI Engine
  await aiEngine.initialize();

  // Real-time service
  await realtimeService.startListening();

  // Routes
  await registerRoutes(app);

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    logger.error({ err: error, url: request.url }, 'Unhandled error');
    const statusCode = error.statusCode || 500;
    reply.code(statusCode).send({
      error: statusCode === 500 ? 'Internal Server Error' : error.message,
      ...(env.NODE_ENV === 'development' && { stack: error.stack }),
    });
  });

  // 404 handler
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'Not Found', path: request.url });
  });

  return app;
}

async function start() {
  try {
    const app = await buildApp();

    // Socket.IO attached to Fastify's own HTTP server (standard Fastify 4
    // pattern — avoids routing every socket.io request through app.routing).
    const io = initializeSocketIO(app.server, env.FRONTEND_URL);
    app.decorate('io', io);

    await app.listen({ port: env.PORT, host: env.HOST });

    logger.info({
      port: env.PORT,
      host: env.HOST,
      env: env.NODE_ENV,
      mission: env.MISSION_NAME,
      firebase: realtimeService.isUsingRestFallback() ? 'rest-fallback' : 'sdk',
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