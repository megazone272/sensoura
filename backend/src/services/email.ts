import nodemailer, { type Transporter } from 'nodemailer';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { getLogger } from '../utils/logger.js';

const env = getEnv();
const logger = getLogger('email');

export type EmailLanguage = 'ar' | 'en';
export type EmailTemplate = 'welcome' | 'sensor-alert' | 'ai-prediction' | 'account-update' | 'contact-confirmation';
export type DeliveryState = 'queued' | 'accepted' | 'failed';

export interface EmailData {
  name?: string;
  dashboardUrl?: string;
  sensorName?: string;
  alertType?: string;
  recordedAt?: string;
  recommendation?: string;
  predictionTitle?: string;
  summary?: string;
  confidence?: string;
  action?: string;
  message?: string;
}

export interface EmailDeliveryRecord {
  id: string;
  recipient: string;
  subject: string;
  template: EmailTemplate;
  language: EmailLanguage;
  state: DeliveryState;
  timestamp: string;
  errorCategory?: string;
}

const emailAddressSchema = z.string().trim().email().max(254);
const templateSchema = z.enum(['welcome', 'sensor-alert', 'ai-prediction', 'account-update', 'contact-confirmation']);
const languageSchema = z.enum(['ar', 'en']);
const history: EmailDeliveryRecord[] = [];
const sentKeys = new Map<string, number>();
let acceptedCount = 0;
let failedCount = 0;
let transporter: Transporter | null = null;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function assertSafeEmail(value: string): string {
  if (/\r|\n/.test(value)) throw new Error('Invalid email address');
  return emailAddressSchema.parse(value).toLowerCase();
}

function trustedDashboardUrl(candidate?: string): string {
  const fallback = env.FRONTEND_URL.split(',')[0]?.trim() ?? 'http://localhost:5173';
  const value = candidate?.trim() || fallback;
  try {
    const parsed = new URL(value);
    const allowed = env.FRONTEND_URL.split(',').map((origin) => origin.trim()).filter(Boolean);
    if (!allowed.includes(parsed.origin)) return fallback;
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function textValue(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 1000) : fallback;
}

function labels(language: EmailLanguage) {
  return language === 'ar'
    ? { dir: 'rtl', greeting: 'مرحبًا', intro: 'مرحبًا بك في سينسورا، منصة الزراعة الذكية والمراقبة اللحظية.', open: 'فتح لوحة التحكم', support: 'للدعم', footer: 'زراعة أذكى لمستقبل أكثر استدامة.', welcome: 'أهلًا بك في SENSOURA', features: ['إدارة المحاصيل الذكية', 'مراقبة الحساسات لحظيًا', 'تنبؤات مدعومة بالذكاء الاصطناعي'] }
    : { dir: 'ltr', greeting: 'Hello', intro: 'Welcome to Sensoura, your smart agriculture and real-time greenhouse monitoring platform.', open: 'Open Dashboard', support: 'Support', footer: 'Smarter Agriculture for a More Sustainable Future.', welcome: 'Welcome to SENSOURA', features: ['Smart crop management', 'Real-time sensor monitoring', 'AI-powered predictions'] };
}

function shell(language: EmailLanguage, title: string, body: string, dashboardUrl: string): { html: string; text: string } {
  const l = labels(language);
  const logoUrl = env.EMAIL_LOGO_URL?.trim();
  const logo = logoUrl ? `<img src="${escapeHtml(logoUrl)}" width="48" height="48" alt="SENSOURA logo" style="display:block;border:0;border-radius:12px;" />` : `<div style="font-size:28px;line-height:1;font-weight:800;color:#d8f3dc;">S</div>`;
  const html = `<!doctype html><html lang="${language}" dir="${l.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef5ef;color:#173b2a;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef5ef;padding:24px 8px;"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;"><tr><td style="background:#123b2a;padding:28px 32px;">${logo}<div style="margin-top:16px;font-size:12px;letter-spacing:2px;color:#b9d9be;font-weight:700;">NASA ANALOG AGRICULTURE MISSION</div></td></tr><tr><td style="padding:32px;">${body}<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;"><tr><td style="border-radius:9px;background:#2d8a57;"><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700;">${l.open}</a></td></tr></table></td></tr><tr><td style="background:#123b2a;padding:24px 32px;color:#d8f3dc;font-size:13px;line-height:1.6;">${l.footer}<br><span style="color:#a8cbb0;">${l.support}: ${escapeHtml(env.SMTP_FROM_EMAIL)}</span></td></tr></table></td></tr></table></body></html>`;
  const text = `${title}\n\n${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n\n${l.open}: ${dashboardUrl}\n${l.support}: ${env.SMTP_FROM_EMAIL}`;
  return { html, text };
}

export function renderEmail(template: EmailTemplate, language: EmailLanguage, data: EmailData = {}): { subject: string; html: string; text: string } {
  const l = labels(language);
  const dashboardUrl = trustedDashboardUrl(data.dashboardUrl);
  const name = escapeHtml(textValue(data.name, language === 'ar' ? 'صديقنا' : 'there'));
  let subject: string;
  let body: string;
  if (template === 'welcome') {
    subject = language === 'ar' ? 'مرحبًا بك في SENSOURA' : 'Welcome to SENSOURA';
    body = `<h1 style="margin:0 0 14px;font-size:30px;color:#123b2a;">${l.welcome}</h1><p style="font-size:18px;line-height:1.7;margin:0 0 12px;">${l.greeting} ${name},</p><p style="font-size:16px;line-height:1.8;color:#496153;">${l.intro}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;"><tr>${l.features.map((feature) => `<td style="padding:14px 8px;background:#edf8ef;border:1px solid #d9eddd;font-size:13px;line-height:1.5;">${escapeHtml(feature)}</td>`).join('')}</tr></table>`;
  } else if (template === 'sensor-alert') {
    subject = language === 'ar' ? `تنبيه حساس: ${textValue(data.sensorName, 'قراءة غير طبيعية')}` : `Sensor alert: ${textValue(data.sensorName, 'abnormal reading')}`;
    body = `<h1 style="margin:0 0 14px;color:#123b2a;">${language === 'ar' ? 'تنبيه من البيت الزراعي' : 'Greenhouse sensor alert'}</h1><p style="line-height:1.8;">${escapeHtml(textValue(data.alertType, language === 'ar' ? 'تم تجاوز حدّ مراقبة' : 'A monitoring threshold was exceeded'))}</p><p style="line-height:1.8;"><strong>${escapeHtml(textValue(data.sensorName, language === 'ar' ? 'الحساس' : 'Sensor'))}</strong><br>${escapeHtml(textValue(data.recordedAt, new Date().toISOString()))}</p><p style="padding:14px;background:#edf8ef;line-height:1.7;">${escapeHtml(textValue(data.recommendation, language === 'ar' ? 'راجع القراءات من لوحة التحكم.' : 'Review the readings in the dashboard.'))}</p>`;
  } else if (template === 'ai-prediction') {
    subject = language === 'ar' ? `تنبؤ زراعي: ${textValue(data.predictionTitle, 'تحديث جديد')}` : `Agricultural prediction: ${textValue(data.predictionTitle, 'New update')}`;
    body = `<h1 style="margin:0 0 14px;color:#123b2a;">${escapeHtml(textValue(data.predictionTitle, language === 'ar' ? 'تنبؤ جديد' : 'New prediction'))}</h1><p style="line-height:1.8;">${escapeHtml(textValue(data.summary, language === 'ar' ? 'يتوفر ملخص جديد من محرك الذكاء الاصطناعي.' : 'A new summary is available from the AI engine.'))}</p>${data.confidence ? `<p style="color:#496153;">${language === 'ar' ? 'الثقة:' : 'Confidence:'} ${escapeHtml(data.confidence)}</p>` : ''}<p style="padding:14px;background:#edf8ef;line-height:1.7;">${escapeHtml(textValue(data.action, language === 'ar' ? 'راجع التوصية قبل اتخاذ أي إجراء.' : 'Review the recommendation before taking action.'))}</p>`;
  } else if (template === 'contact-confirmation') {
    subject = language === 'ar' ? 'تم استلام رسالتك إلى SENSOURA' : 'Your message to SENSOURA was received';
    body = `<h1 style="margin:0 0 14px;color:#123b2a;">${language === 'ar' ? 'شكرًا لتواصلك' : 'Thank you for contacting us'}</h1><p style="line-height:1.8;">${language === 'ar' ? 'تم استلام رسالتك وسيراجعها فريقنا.' : 'Your message has been received and our team will review it.'}</p>`;
  } else {
    subject = language === 'ar' ? 'تحديث أمني لحسابك في SENSOURA' : 'Security update for your SENSOURA account';
    body = `<h1 style="margin:0 0 14px;color:#123b2a;">${language === 'ar' ? 'تحديث الحساب' : 'Account update'}</h1><p style="line-height:1.8;">${escapeHtml(textValue(data.message, language === 'ar' ? 'حدث تغيير مهم في حسابك.' : 'An important change was made to your account.'))}</p>`;
  }
  const rendered = shell(language, subject, body, dashboardUrl);
  return { subject, ...rendered };
}

function smtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM_EMAIL);
}

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!smtpConfigured()) return null;
  transporter = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
  return transporter;
}

/** Test-only seam; production code never calls this function. */
export function setEmailTransporterForTests(value: Transporter | null): void {
  transporter = value;
}

function addRecord(record: EmailDeliveryRecord): void {
  history.unshift(record);
  if (history.length > 50) history.pop();
}

export function getEmailStatus() {
  return { configured: smtpConfigured(), host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, sender: env.SMTP_FROM_EMAIL, senderName: env.SMTP_FROM_NAME, acceptedCount, failedCount, lastAttempt: history[0]?.timestamp ?? null, history: history.slice(0, 20) };
}

export async function verifySmtpConnection(): Promise<{ ok: boolean; reason?: string }> {
  const current = getTransporter();
  if (!current) return { ok: false, reason: 'SMTP_PASS is not configured' };
  try { await current.verify(); return { ok: true }; } catch { logger.warn({ errorCategory: 'smtp_connection_verification_failed' }, 'SMTP verification failed'); return { ok: false, reason: 'SMTP connection verification failed' }; }
}

export async function sendEmail(recipient: string, template: EmailTemplate, language: EmailLanguage, data: EmailData = {}, options: { dedupeKey?: string; cooldownMs?: number } = {}): Promise<EmailDeliveryRecord> {
  const to = assertSafeEmail(recipient);
  const parsedTemplate = templateSchema.parse(template);
  const parsedLanguage = languageSchema.parse(language);
  const key = options.dedupeKey;
  if (key && (sentKeys.get(key) ?? 0) > Date.now()) throw new Error('Duplicate notification suppressed');
  const rendered = renderEmail(parsedTemplate, parsedLanguage, data);
  const record: EmailDeliveryRecord = { id: `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, recipient: to, subject: rendered.subject, template: parsedTemplate, language: parsedLanguage, state: 'queued', timestamp: new Date().toISOString() };
  addRecord(record);
  const current = getTransporter();
  if (!current) { record.state = 'failed'; record.errorCategory = 'smtp_not_configured'; failedCount += 1; throw new Error('SMTP is not configured; SMTP_PASS must be supplied in the backend environment'); }
  try {
    await current.sendMail({ from: { name: env.SMTP_FROM_NAME, address: env.SMTP_FROM_EMAIL }, to, subject: rendered.subject, text: rendered.text, html: rendered.html });
    record.state = 'accepted'; acceptedCount += 1;
    if (key) sentKeys.set(key, Date.now() + (options.cooldownMs ?? 15 * 60_000));
    logger.info({ recipient: to, template: parsedTemplate, language: parsedLanguage, state: record.state }, 'Email accepted by SMTP server');
    return record;
  } catch { record.state = 'failed'; record.errorCategory = 'smtp_delivery_error'; failedCount += 1; logger.warn({ recipient: to, template: parsedTemplate, errorCategory: record.errorCategory }, 'Email delivery failed'); throw new Error('Email could not be accepted by the SMTP server'); }
}

export function previewEmail(template: EmailTemplate, language: EmailLanguage): { subject: string; html: string; text: string } {
  return renderEmail(template, language, { name: language === 'ar' ? 'ضيف SENSOURA' : 'SENSOURA guest', dashboardUrl: trustedDashboardUrl() });
}

export const emailSchemas = { emailAddress: emailAddressSchema, template: templateSchema, language: languageSchema };
