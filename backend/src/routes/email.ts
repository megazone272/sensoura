import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePrivileged, resolveCaptured } from '../services/auth.js';
import { emailSchemas, getEmailStatus, previewEmail, sendEmail, verifySmtpConnection } from '../services/email.js';

const testEmailSchema = z.object({
  recipient: emailSchemas.emailAddress,
  template: emailSchemas.template.default('welcome'),
  language: emailSchemas.language.default('en'),
}).strict();

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const auth = resolveCaptured(request);
  if (auth.role !== 'admin') {
    reply.code(403).send({ error: 'Forbidden', message: 'Administrator privileges are required for email administration' });
    return false;
  }
  return true;
}

export function registerEmailRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/admin/email/status', { preHandler: [requirePrivileged] }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return getEmailStatus();
  });

  fastify.get('/api/admin/email/verify', { preHandler: [requirePrivileged] }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const result = await verifySmtpConnection();
    return result.ok ? result : reply.code(503).send(result);
  });

  fastify.get('/api/admin/email/preview', { preHandler: [requirePrivileged] }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const query = z.object({ template: emailSchemas.template.default('welcome'), language: emailSchemas.language.default('en') }).strict().safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid email preview request' });
    return previewEmail(query.data.template, query.data.language);
  });

  fastify.post('/api/admin/email/test', { preHandler: [requirePrivileged] }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parsed = testEmailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid test email request', details: parsed.error.flatten() });
    try {
      const record = await sendEmail(parsed.data.recipient, parsed.data.template, parsed.data.language, { name: parsed.data.recipient.split('@')[0] });
      return { success: true, delivery: record };
    } catch {
      return reply.code(503).send({ error: 'Email test could not be accepted by the SMTP server' });
    }
  });
}
