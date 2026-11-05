import type { FastifyInstance } from 'fastify';
import { sendFirebaseVerificationEmail, FirebaseEmailVerificationError } from '../services/firebaseEmailVerification.js';

function bearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

export function registerFirebaseEmailVerificationRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/auth/email-verification/send', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: 'A Firebase session is required' });
    try {
      return await sendFirebaseVerificationEmail(token);
    } catch (error) {
      if (error instanceof FirebaseEmailVerificationError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      return reply.code(503).send({ error: 'Verification email could not be sent' });
    }
  });
}
