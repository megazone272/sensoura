import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { isDisposableEmailAddress } from './auth.js';
import { getFirebaseAuth, isFirebaseEnabled } from './firebase.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('email-verification');
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_CODES_PER_WINDOW = 5;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_TRACKED_USERS = 10_000;

export class EmailVerificationError extends Error {
  constructor(message: string, public readonly statusCode: number = 400) {
    super(message);
    this.name = 'EmailVerificationError';
  }
}

export interface EmailVerificationIdentity {
  uid: string;
  email: string;
  provider: string;
  emailVerified: boolean;
  emailCodeVerifiedEmail: string;
}

interface PendingCode {
  digest: Buffer;
  expiresAt: number;
  sentAt: number;
  attempts: number;
}

interface SendWindow {
  startedAt: number;
  count: number;
  lastSentAt: number;
}

interface EmailVerificationDependencies {
  isConfigured: () => boolean;
  verifyIdentity: (idToken: string) => Promise<EmailVerificationIdentity>;
  sendEmail: (email: string, code: string) => Promise<void>;
  markEmailVerified: (uid: string) => Promise<void>;
  now?: () => number;
  pepper?: Buffer;
}

export interface EmailVerificationService {
  isConfigured: () => boolean;
  requestCode: (idToken: string) => Promise<{ sent: boolean; retryAfterSeconds: number }>;
  verifyCode: (idToken: string, code: string) => Promise<void>;
}

function digestCode(pepper: Buffer, uid: string, email: string, code: string): Buffer {
  return createHmac('sha256', pepper).update(`${uid}\0${email.toLowerCase()}\0${code}`).digest();
}

function safeDigestEqual(expected: Buffer, actual: Buffer): boolean {
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hasEmailCodeProofForCurrentAddress(identity: EmailVerificationIdentity): boolean {
  return identity.emailCodeVerifiedEmail.trim().toLowerCase() === identity.email.trim().toLowerCase();
}

export function createEmailVerificationService(
  dependencies: EmailVerificationDependencies,
): EmailVerificationService {
  const pendingCodes = new Map<string, PendingCode>();
  const sendWindows = new Map<string, SendWindow>();
  const now = dependencies.now ?? Date.now;
  const pepper = dependencies.pepper ?? randomBytes(32);

  const prune = (currentTime: number): void => {
    for (const [uid, record] of pendingCodes) {
      if (record.expiresAt <= currentTime) pendingCodes.delete(uid);
    }
    for (const [uid, window] of sendWindows) {
      if (window.startedAt + SEND_WINDOW_MS <= currentTime) sendWindows.delete(uid);
    }
  };

  const resolveIdentity = async (idToken: string): Promise<EmailVerificationIdentity> => {
    if (!idToken || idToken.length > 8192) {
      throw new EmailVerificationError('Invalid or expired sign-in session', 401);
    }
    let identity: EmailVerificationIdentity;
    try {
      identity = await dependencies.verifyIdentity(idToken);
    } catch {
      throw new EmailVerificationError('Invalid or expired sign-in session', 401);
    }
    if (!identity.uid || !identity.email || identity.provider !== 'password') {
      throw new EmailVerificationError('Email/password sign-in is required for code verification', 403);
    }
    if (isDisposableEmailAddress(identity.email)) {
      throw new EmailVerificationError('Disposable email addresses are not allowed', 403);
    }
    return identity;
  };

  return {
    isConfigured: dependencies.isConfigured,

    async requestCode(idToken) {
      if (!dependencies.isConfigured()) {
        throw new EmailVerificationError('Email verification is not configured', 503);
      }

      const identity = await resolveIdentity(idToken);
      if (identity.emailVerified && hasEmailCodeProofForCurrentAddress(identity)) {
        throw new EmailVerificationError('Email is already verified', 409);
      }

      const currentTime = now();
      prune(currentTime);
      const existingWindow = sendWindows.get(identity.uid);
      if (existingWindow && currentTime - existingWindow.lastSentAt < RESEND_COOLDOWN_MS) {
        const retryAfterSeconds = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - (currentTime - existingWindow.lastSentAt)) / 1000));
        return { sent: false, retryAfterSeconds };
      }

      let sendWindow = existingWindow;
      if (!sendWindow || currentTime - sendWindow.startedAt >= SEND_WINDOW_MS) {
        sendWindow = { startedAt: currentTime, count: 0, lastSentAt: 0 };
      }
      if (sendWindow.count >= MAX_CODES_PER_WINDOW) {
        throw new EmailVerificationError('Too many verification code emails. Try again later.', 429);
      }

      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      sendWindow.count += 1;
      sendWindow.lastSentAt = currentTime;
      sendWindows.set(identity.uid, sendWindow);

      try {
        await dependencies.sendEmail(identity.email, code);
      } catch {
        throw new EmailVerificationError('Verification code could not be sent', 502);
      }

      pendingCodes.delete(identity.uid);
      pendingCodes.set(identity.uid, {
        digest: digestCode(pepper, identity.uid, identity.email, code),
        expiresAt: currentTime + CODE_TTL_MS,
        sentAt: currentTime,
        attempts: 0,
      });
      while (pendingCodes.size > MAX_TRACKED_USERS) {
        const oldestUid = pendingCodes.keys().next().value as string | undefined;
        if (!oldestUid) break;
        pendingCodes.delete(oldestUid);
      }

      return { sent: true, retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000) };
    },

    async verifyCode(idToken, code) {
      if (!/^\d{6}$/.test(code)) {
        throw new EmailVerificationError('Invalid or expired verification code', 400);
      }

      const identity = await resolveIdentity(idToken);
      if (identity.emailVerified && hasEmailCodeProofForCurrentAddress(identity)) {
        throw new EmailVerificationError('Email is already verified', 409);
      }
      const currentTime = now();
      prune(currentTime);
      const pending = pendingCodes.get(identity.uid);
      if (!pending || pending.expiresAt <= currentTime) {
        pendingCodes.delete(identity.uid);
        throw new EmailVerificationError('Invalid or expired verification code', 400);
      }

      pending.attempts += 1;
      const candidateDigest = digestCode(pepper, identity.uid, identity.email, code);
      if (!safeDigestEqual(pending.digest, candidateDigest)) {
        if (pending.attempts >= MAX_VERIFY_ATTEMPTS) {
          pendingCodes.delete(identity.uid);
          throw new EmailVerificationError('Too many incorrect verification codes. Request a new one.', 429);
        }
        throw new EmailVerificationError('Invalid or expired verification code', 400);
      }

      // Consume before awaiting Firebase so simultaneous submissions cannot reuse one code.
      pendingCodes.delete(identity.uid);
      const firebaseAuth = getFirebaseAuth();
      if (firebaseAuth) {
        try {
          await firebaseAuth.updateUser(identity.uid, { emailVerified: true });
          const user = await firebaseAuth.getUser(identity.uid);
          await firebaseAuth.setCustomUserClaims(identity.uid, {
            ...user.customClaims,
            email_code_verified_email: identity.email.trim().toLowerCase(),
          });
          await firebaseAuth.revokeRefreshTokens(identity.uid);
          return;
        } catch {
          logger.warn({ errorCategory: 'firebase_email_verification_update_failed' }, 'Firebase email verification update failed');
          throw new EmailVerificationError('Could not verify the email address. Request a new code.', 503);
        }
      }

      try {
        await dependencies.markEmailVerified(identity.uid);
      } catch {
        throw new EmailVerificationError('Could not verify the email address. Request a new code.', 503);
      }
    },
  };
}

async function sendResendEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const sender = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !sender) throw new Error('Resend is not configured');

  const text = [
    `Your SENSOURA verification code is: ${code}`,
    'It expires in 10 minutes. Do not share this code.',
    '',
    `رمز تأكيد SENSOURA هو: ${code}`,
    'تنتهي صلاحيته خلال 10 دقائق. لا تشارك هذا الرمز مع أي شخص.',
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#14202b"><h2>SENSOURA</h2><p>Your verification code / رمز التأكيد:</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:18px 22px;background:#eef7f5;border-radius:12px;display:inline-block">${code}</div><p>This code expires in 10 minutes. Do not share it.<br>تنتهي صلاحية الرمز خلال 10 دقائق. لا تشاركه مع أي شخص.</p></div>`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `SENSOURA <${sender}>`,
        to: [email],
        subject: 'SENSOURA verification code | رمز تأكيد SENSOURA',
        text,
        html,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Resend rejected a verification email');
      throw new Error('Resend rejected the email request');
    }
  } finally {
    clearTimeout(timeout);
  }
}

const firebaseEmailVerificationService = createEmailVerificationService({
  isConfigured: () => isFirebaseEnabled()
    && Boolean(getFirebaseAuth())
    && Boolean(process.env.RESEND_API_KEY?.trim())
    && Boolean(process.env.RESEND_FROM_EMAIL?.trim()),
  verifyIdentity: async (idToken) => {
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth || !isFirebaseEnabled()) throw new Error('Firebase Auth is unavailable');
    const claims = await firebaseAuth.verifyIdToken(idToken, true);
    return {
      uid: claims.uid,
      email: typeof claims.email === 'string' ? claims.email : '',
      provider: claims.firebase?.sign_in_provider ?? '',
      emailVerified: claims.email_verified === true,
      emailCodeVerifiedEmail: typeof claims.email_code_verified_email === 'string' ? claims.email_code_verified_email : '',
    };
  },
  sendEmail: sendResendEmail,
  markEmailVerified: async (uid) => {
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) throw new Error('Firebase Auth is unavailable');
    await firebaseAuth.updateUser(uid, { emailVerified: true });
    const user = await firebaseAuth.getUser(uid);
    const normalizedEmail = user.email?.trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Firebase user has no email address');
    await firebaseAuth.setCustomUserClaims(uid, {
      ...user.customClaims,
      email_code_verified_email: normalizedEmail,
    });
    await firebaseAuth.revokeRefreshTokens(uid);
  },
});

export const emailVerificationService = firebaseEmailVerificationService;
