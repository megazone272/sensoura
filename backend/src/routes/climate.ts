import type { FastifyInstance } from 'fastify';
import { ClimateRequestError, nasaPowerDailyService } from '../services/nasaPower.js';

interface ClimateReader {
  getLatest(): Promise<{
    observation: Awaited<ReturnType<typeof nasaPowerDailyService.getLatest>>['observation'];
    retrievedAt: string | null;
    stale: boolean;
  }>;
  getHistory(start: string, end: string): ReturnType<typeof nasaPowerDailyService.getHistory>;
  getStatus(): ReturnType<typeof nasaPowerDailyService.getStatus>;
}

export async function registerClimateRoutes(fastify: FastifyInstance, climate: ClimateReader = nasaPowerDailyService): Promise<void> {
  fastify.get('/api/climate/current', async (_request, reply) => {
    try {
      const latest = await climate.getLatest();
      return {
        ...latest,
        source: 'NASA POWER',
        location: 'Cairo, Egypt',
        caveat: 'Daily gridded outdoor climate data; not real-time and not a greenhouse sensor.',
      };
    } catch (error) {
      const code = error instanceof ClimateRequestError ? error.code : 'UPSTREAM';
      return reply.code(code === 'INVALID_DATE' || code === 'DATE_RANGE' ? 400 : 503).send({
        error: 'Climate data unavailable', code,
      });
    }
  });

  fastify.get('/api/climate/history', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).some((key) => key !== 'start' && key !== 'end') ||
        typeof query.start !== 'string' || typeof query.end !== 'string') {
      return reply.code(400).send({ error: 'Both start and end are required as YYYYMMDD', code: 'INVALID_QUERY' });
    }
    try {
      return await climate.getHistory(query.start, query.end);
    } catch (error) {
      const isClimateError = error instanceof ClimateRequestError;
      const code = isClimateError ? error.code : 'UPSTREAM';
      const badRequest = code === 'INVALID_DATE' || code === 'DATE_RANGE';
      return reply.code(badRequest ? 400 : 503).send({
        error: badRequest && isClimateError ? error.message : 'Climate data unavailable', code,
      });
    }
  });

  fastify.get('/api/climate/status', async () => climate.getStatus());
}
