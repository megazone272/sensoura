import { getEnv } from '../config/env.js';
import { getFirebaseAuth } from './firebase.js';
import { isDisposableEmailAddress } from './auth.js';
import { sendEmail } from './email.js';
import { getLogger } from '../utils/logger.js';

const env = getEnv();
const logger = getLogger('firebase-email-verification');
const resendAt = new Map<string, number>();
const RESEND_COOLDOWN_MS = 60_000;
const MAX_TRACKED_USERS = 10_000;

export class FirebaseEmailVerificationError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'FirebaseEmailVerificationError';
  }
}

function frontendContinueUrl(): string {
  const origin = env.FRONTEND_URL.split(',').map((item) => item.trim()).find(Boolean);
  if (!origin) throw new FirebaseEmailVerificationError(503, 'Verification email is not configured');
  return new URL('/verify-email?status=success', origin).toString();
}

function prune(now: number): void {
  for (const [key, expiresAt] of resendAt) if (expiresAt <= now) resendAt.delete(key);
  while (resendAt.size > MAX_TRACKED_USERS) {
    const oldest = resendAt.keys().next().value;
    if (oldest === undefined) break;
    resendAt.delete(oldest);
  }
}

export async function sendFirebaseVerificationEmail(idToken: string): Promise<{ sent: boolean; retryAfterSeconds?: number }> {
  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) throw new FirebaseEmailVerificationError(503, 'Firebase email verification is unavailable');
  const now = Date.now();
  prune(now);
  try {
    const decoded = await firebaseAuth.verifyIdToken(idToken);
    if (decoded.firebase?.sign_in_provider !== 'password' || typeof decoded.email !== 'string' || !decoded.uid) {
      throw new FirebaseEmailVerificationError(403, 'Email/password verification is required');
    }
    const email = decoded.email.trim().toLowerCase();
    if (decoded.email_verified === true) throw new FirebaseEmailVerificationError(409, 'Email is already verified');
    if (isDisposableEmailAddress(email)) throw new FirebaseEmailVerificationError(403, 'Disposable email addresses are not allowed');
    const availableAt = resendAt.get(decoded.uid) ?? 0;
    if (availableAt > now) {
      return { sent: false, retryAfterSeconds: Math.ceil((availableAt - now) / 1000) };
    }
    const user = await firebaseAuth.getUser(decoded.uid);
    const verificationLink = await firebaseAuth.generateEmailVerificationLink(email, {
      url: frontendContinueUrl(),
      handleCodeInApp: false,
    });
    await sendEmail(email, 'email-verification', env.EMAIL_DEFAULT_LANGUAGE, {
      name: user.displayName?.trim() || email.split('@')[0],
      verificationLink,
    }, { dedupeKey: `firebase-verification:${decoded.uid}`, cooldownMs: RESEND_COOLDOWN_MS });
    resendAt.set(decoded.uid, now + RESEND_COOLDOWN_MS);
    return { sent: true };
  } catch (error) {
    if (error instanceof FirebaseEmailVerificationError) throw error;
    logger.warn({ errorCategory: 'firebase_verification_email_failed' }, 'Firebase verification email was not sent');
    throw new FirebaseEmailVerificationError(503, 'Verification email could not be sent');
  }
}
