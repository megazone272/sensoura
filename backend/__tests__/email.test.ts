import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewEmail, renderEmail, sendEmail, setEmailTransporterForTests } from '../src/services/email.js';

const transporter = {
  verify: vi.fn().mockResolvedValue(true),
  sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-message-id' }),
} as any;

afterEach(() => {
  transporter.verify.mockReset().mockResolvedValue(true);
  transporter.sendMail.mockReset().mockResolvedValue({ messageId: 'mock-message-id' });
  setEmailTransporterForTests(null);
});

describe('transactional email service', () => {
  it('renders bilingual welcome email with safe escaped values and direction', () => {
    const en = renderEmail('welcome', 'en', { name: '<Alice>', dashboardUrl: 'http://localhost:5173' });
    const ar = renderEmail('welcome', 'ar', { name: '<علي>', dashboardUrl: 'http://localhost:5173' });
    expect(en.html).toContain('dir="ltr"');
    expect(en.html).toContain('&lt;Alice&gt;');
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain('&lt;علي&gt;');
    expect(en.text).toContain('Welcome to SENSOURA');
  });

  it('renders a branded verification email with a safe button and fallback link', () => {
    const link = 'https://on-an-official-team.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=opaque';
    const rendered = renderEmail('email-verification', 'en', { name: '<Grower>', verificationLink: link });
    expect(rendered.subject).toContain('Verify');
    expect(rendered.html).toContain('Verify Email');
    expect(rendered.html).toContain(link.replaceAll('&', '&amp;'));
    expect(rendered.html).toContain('&lt;Grower&gt;');
    expect(rendered.text).toContain(link);
  });

  it('renders preview without requiring SMTP credentials', () => {
    const preview = previewEmail('sensor-alert', 'en');
    expect(preview.subject).toContain('Sensor alert');
    expect(preview.html).toContain('role="presentation"');
    expect(preview.text).toContain('Open Dashboard');
  });

  it('accepts a mocked SMTP delivery and records no secret values', async () => {
    setEmailTransporterForTests(transporter);
    const result = await sendEmail('test@example.com', 'welcome', 'en', { name: 'Tester' });
    expect(result.state).toBe('accepted');
    expect(transporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'test@example.com', html: expect.stringContaining('Tester') }));
  });

  it('rejects invalid and header-injection recipients before transport', async () => {
    setEmailTransporterForTests(transporter);
    await expect(sendEmail('invalid', 'welcome', 'en')).rejects.toThrow();
    await expect(sendEmail('test@example.com\r\nBcc:evil@example.com', 'welcome', 'en')).rejects.toThrow();
    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  it('maps SMTP errors to a safe public error', async () => {
    transporter.sendMail.mockRejectedValueOnce(new Error('secret SMTP password or server detail'));
    setEmailTransporterForTests(transporter);
    await expect(sendEmail('test@example.com', 'account-update', 'en', { message: 'Review your account' })).rejects.toThrow('Email could not be accepted');
  });
});
