import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emailVerificationService } from '../services/emailVerification.js';

const requestCodeSchema = z.object({
  idToken: z.string().min(100).max(8192),
}).strict();

const verifyCodeSchema = z.object({
  idToken: z.string().min(100).max(8192),
  code: z.string().regex(/^\d{6}$/),
}).strict();

export function registerAuthVerificationRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/auth/email-code/status', async () => ({
    enabled: emailVerificationService.isConfigured(),
  }));

  fastify.post<{ Body: z.infer<typeof requestCodeSchema> }>(
    '/api/auth/email-code/request',
    async (request, reply) => {
      const parsed = requestCodeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid verification request' });
      }
      const result = await emailVerificationService.requestCode(parsed.data.idToken);
      return { success: true, ...result };
    },
  );

  fastify.post<{ Body: z.infer<typeof verifyCodeSchema> }>(
    '/api/auth/email-code/verify',
    async (request, reply) => {
      const parsed = verifyCodeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid verification code' });
      }
      await emailVerificationService.verifyCode(parsed.data.idToken, parsed.data.code);
      return { success: true };
    },
  );
}
