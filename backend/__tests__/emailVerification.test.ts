import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmailVerificationService,
  EmailVerificationError,
  type EmailVerificationIdentity,
} from '../src/services/emailVerification.js';

const identity: EmailVerificationIdentity = {
  uid: 'firebase-user-1',
  email: 'grower@example.org',
  provider: 'password',
  emailVerified: false,
  emailCodeVerifiedEmail: '',
};

function createService(overrides: Partial<{
  configured: boolean;
  user: EmailVerificationIdentity;
  now: () => number;
  sendEmail: (email: string, code: string) => Promise<void>;
  markEmailVerified: (uid: string) => Promise<void>;
}> = {}) {
  let codeSent: string | null = null;
  const sendEmail = overrides.sendEmail ?? vi.fn(async (_email: string, code: string) => { codeSent = code; });
  const markEmailVerified = overrides.markEmailVerified ?? vi.fn(async () => undefined);
  const service = createEmailVerificationService({
    isConfigured: () => overrides.configured ?? true,
    verifyIdentity: async () => overrides.user ?? identity,
    sendEmail,
    markEmailVerified,
    now: overrides.now,
    pepper: Buffer.from('unit-test-pepper-that-is-not-a-real-secret'),
  });
  return { service, sendEmail, markEmailVerified, getCode: () => codeSent };
}

describe('email verification codes', () => {
  beforeEach(() => {
    delete process.env.DISPOSABLE_EMAIL_DOMAINS;
  });

  it('sends and consumes a six-digit code exactly once', async () => {
    const { service, sendEmail, markEmailVerified, getCode } = createService();
    await expect(service.requestCode('a'.repeat(150))).resolves.toMatchObject({ sent: true });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(getCode()).toMatch(/^\d{6}$/);

    await service.verifyCode('a'.repeat(150), getCode()!);
    expect(markEmailVerified).toHaveBeenCalledOnce();
    expect(markEmailVerified).toHaveBeenCalledWith(identity.uid);
    await expect(service.verifyCode('a'.repeat(150), getCode()!)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('enforces resend cooldown and hourly per-user limits', async () => {
    let clock = 1_000_000;
    const { service, sendEmail } = createService({ now: () => clock });
    await expect(service.requestCode('a'.repeat(150))).resolves.toMatchObject({ sent: true });
    await expect(service.requestCode('a'.repeat(150))).resolves.toMatchObject({ sent: false, retryAfterSeconds: 60 });
    expect(sendEmail).toHaveBeenCalledOnce();

    for (let i = 0; i < 4; i += 1) {
      clock += 60_001;
      await service.requestCode('a'.repeat(150));
    }
    clock += 60_001;
    await expect(service.requestCode('a'.repeat(150))).rejects.toBeInstanceOf(EmailVerificationError);
    expect(sendEmail).toHaveBeenCalledTimes(5);
  });

  it('expires codes after ten minutes', async () => {
    let clock = 2_000_000;
    const { service, getCode } = createService({ now: () => clock });
    await service.requestCode('a'.repeat(150));
    clock += 10 * 60 * 1000 + 1;
    await expect(service.verifyCode('a'.repeat(150), getCode()!)).rejects.toMatchObject({
      message: 'Invalid or expired verification code',
      statusCode: 400,
    });
  });

  it('locks the code after five incorrect attempts', async () => {
    const { service, getCode } = createService();
    await service.requestCode('a'.repeat(150));
    const wrongCode = getCode() === '000000' ? '000001' : '000000';
    for (let attempt = 1; attempt < 5; attempt += 1) {
      await expect(service.verifyCode('a'.repeat(150), wrongCode)).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(service.verifyCode('a'.repeat(150), wrongCode)).rejects.toMatchObject({ statusCode: 429 });
    await expect(service.verifyCode('a'.repeat(150), getCode()!)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects OAuth identities, verified identities, and disposable domains', async () => {
    const oauth = createService({ user: { ...identity, provider: 'google.com' } });
    await expect(oauth.service.requestCode('a'.repeat(150))).rejects.toMatchObject({ statusCode: 403 });

    const verified = createService({ user: { ...identity, emailVerified: true, emailCodeVerifiedEmail: identity.email } });
    await expect(verified.service.requestCode('a'.repeat(150))).rejects.toMatchObject({ statusCode: 409 });

    const firebaseLinkOnly = createService({ user: { ...identity, emailVerified: true, emailCodeVerifiedEmail: 'old@example.org' } });
    await expect(firebaseLinkOnly.service.requestCode('a'.repeat(150))).resolves.toMatchObject({ sent: true });

    const disposable = createService({ user: { ...identity, email: 'grower@mailinator.com' } });
    await expect(disposable.service.requestCode('a'.repeat(150))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('does not issue codes before Resend and Firebase are configured', async () => {
    const { service, sendEmail } = createService({ configured: false });
    await expect(service.requestCode('a'.repeat(150))).rejects.toMatchObject({ statusCode: 503 });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
