import { describe, expect, it } from 'vitest';
import { renderPremiumVerificationEmail } from '../src/services/verificationEmailTemplate.js';
import { previewEmail } from '../src/services/email.js';

describe('Premium Botanical Email Verification Template', () => {
  const sampleLink = 'https://on-an-official-team.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=secure-token-12345';

  it('renders English template with LTR direction and brand headline', () => {
    const rendered = renderPremiumVerificationEmail('en', {
      name: 'Nour',
      verificationLink: sampleLink,
    });

    expect(rendered.subject).toBe('Verify your email | SENSOURA');
    expect(rendered.html).toContain('dir="ltr"');
    expect(rendered.html).toContain('A smarter future starts with');
    expect(rendered.html).toContain('one click.');
    expect(rendered.html).toContain('Verify your email address.');
    expect(rendered.html).toContain('VERIFY EMAIL ADDRESS →');
    expect(rendered.html).toContain(sampleLink.replaceAll('&', '&amp;'));
  });

  it('renders Arabic template with RTL direction and Arabic localized content', () => {
    const rendered = renderPremiumVerificationEmail('ar', {
      name: 'نور',
      verificationLink: sampleLink,
    });

    expect(rendered.subject).toBe('أكّد بريدك الإلكتروني | SENSOURA');
    expect(rendered.html).toContain('dir="rtl"');
    expect(rendered.html).toContain('مستقبل الزراعة الذكية يبدأ بـ');
    expect(rendered.html).toContain('نقرة واحدة.');
    expect(rendered.html).toContain('تأكيد البريد الإلكتروني.');
    expect(rendered.html).toContain('تأكيد البريد الإلكتروني ←');
  });

  it('includes all specified SENSOURA brand colors', () => {
    const rendered = renderPremiumVerificationEmail('en', {
      name: 'Grower',
      verificationLink: sampleLink,
    });

    expect(rendered.html).toContain('#061514'); // Dark forest bg
    expect(rendered.html).toContain('#087B58'); // Emerald CTA
    expect(rendered.html).toContain('#56DCC8'); // Mint accent
    expect(rendered.html).toContain('#FFFFFF'); // Clean white
    expect(rendered.html).toContain('#F4FAF7'); // Light mint card
  });

  it('escapes user input to prevent HTML injection attacks', () => {
    const maliciousLink = 'https://sensoura.ox0x.com/auth/action?mode=verifyEmail&oobCode=<script>alert("xss")</script>';
    const rendered = renderPremiumVerificationEmail('en', {
      name: '<script>',
      verificationLink: maliciousLink,
    });

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });

  it('embeds botanical visual assets correctly without full-email duplicate artwork', () => {
    const rendered = renderPremiumVerificationEmail('en', {
      verificationLink: sampleLink,
    });

    expect(rendered.html).toContain('https://sensoura.ox0x.com/sensoura-email-plant.jpg');
    expect(rendered.html).toContain('https://sensoura.ox0x.com/sensoura-email-landscape.jpg');
    expect(rendered.html).toContain('https://sensoura.ox0x.com/sensoura-email-badge.png');
  });

  it('includes 24-hour expiration and account safety notices', () => {
    const rendered = renderPremiumVerificationEmail('en', {
      verificationLink: sampleLink,
    });

    expect(rendered.html).toContain('expire in');
    expect(rendered.html).toContain('24 hours.');
    expect(rendered.html).toContain('safely ignore this email');
    expect(rendered.html).toContain('info@sensoura.ox0x.com');
  });

  it('includes platform capability indicators matching design reference', () => {
    const rendered = renderPremiumVerificationEmail('en', {
      verificationLink: sampleLink,
    });

    expect(rendered.html).toContain('Real-time Monitoring');
    expect(rendered.html).toContain('AI Predictions');
    expect(rendered.html).toContain('Crop Insights');
    expect(rendered.html).toContain('Smart Alerts');
  });

  it('throws an error if verificationLink is missing', () => {
    expect(() => renderPremiumVerificationEmail('en', { name: 'Grower' })).toThrow('Verification link is required');
    expect(() => renderPremiumVerificationEmail('en', { verificationLink: '   ' })).toThrow('Verification link is required');
  });

  it('generates a clean plain text fallback version', () => {
    const rendered = renderPremiumVerificationEmail('en', {
      name: 'Nour',
      verificationLink: sampleLink,
    });

    expect(rendered.text).toContain('SENSOURA');
    expect(rendered.text).toContain('Verify your email address.');
    expect(rendered.text).toContain(sampleLink);
    expect(rendered.text).toContain('info@sensoura.ox0x.com');
    expect(rendered.text).not.toContain('<!DOCTYPE');
    expect(rendered.text).not.toContain('<table');
  });

  it('supports previewEmail for email-verification without throwing', () => {
    const preview = previewEmail('email-verification', 'en');
    expect(preview.subject).toContain('Verify');
    expect(preview.html).toContain('VERIFY EMAIL ADDRESS');
    expect(preview.html).toContain('sensoura.ox0x.com');
  });
});
