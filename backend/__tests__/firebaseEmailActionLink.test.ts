import { describe, expect, it } from 'vitest';
import { buildBrandedActionUrl, FirebaseEmailVerificationError } from '../src/services/firebaseEmailVerification.js';
import { getEnv } from '../src/config/env.js';

describe('buildBrandedActionUrl', () => {
  it('correctly transforms a Firebase Admin-generated link into a SENSOURA branded action URL', () => {
    const rawFirebaseLink = 'https://on-an-official-team.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=REAL_OOB_CODE_12345&apiKey=AIzaSyFakeApiKey&continueUrl=https%3A%2F%2Fsensoura.ox0x.com%2Flogin%3FemailVerified%3D1&lang=en';

    const brandedUrl = buildBrandedActionUrl(rawFirebaseLink, 'ar');
    const parsed = new URL(brandedUrl);
    const expectedOrigin = new URL(getEnv().FRONTEND_URL.split(',')[0].trim()).origin;

    expect(parsed.origin).toBe(expectedOrigin);
    expect(parsed.pathname).toBe('/auth/action');
    expect(parsed.searchParams.get('mode')).toBe('verifyEmail');
    expect(parsed.searchParams.get('oobCode')).toBe('REAL_OOB_CODE_12345');
    expect(parsed.searchParams.get('apiKey')).toBe('AIzaSyFakeApiKey');
    expect(parsed.searchParams.get('lang')).toBe('ar');
    expect(parsed.searchParams.get('continueUrl')).toBe('https://sensoura.ox0x.com/login?emailVerified=1');
  });

  it('rejects links from untrusted external hosts', () => {
    const phishingLink = 'https://malicious-phishing-site.com/__/auth/action?mode=verifyEmail&oobCode=FAKE_CODE';

    expect(() => buildBrandedActionUrl(phishingLink)).toThrow(FirebaseEmailVerificationError);
    expect(() => buildBrandedActionUrl(phishingLink)).toThrow(/Unexpected verification link domain/);
  });

  it('rejects links missing an oobCode', () => {
    const invalidLink = 'https://on-an-official-team.firebaseapp.com/__/auth/action?mode=verifyEmail&apiKey=AIzaSyFakeApiKey';

    expect(() => buildBrandedActionUrl(invalidLink)).toThrow(FirebaseEmailVerificationError);
    expect(() => buildBrandedActionUrl(invalidLink)).toThrow(/Verification code missing from link/);
  });

  it('rejects malformed URLs', () => {
    expect(() => buildBrandedActionUrl('not-a-valid-url')).toThrow(FirebaseEmailVerificationError);
  });
});
