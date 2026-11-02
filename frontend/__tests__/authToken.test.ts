import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthorizationRoleHint, getFreshAccessToken, hasControlAccessHint, isDisposableEmailAddress, isLocalDevelopmentEnvironment, isLoopbackHost } from '@services/authToken';

const ACCESS_TOKEN_KEY = 'sensoura-token';
const EXPIRY_KEY = 'sensoura-token-expires-at';

describe('local development operator token', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_API_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('recognizes only loopback hostnames as local', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('192.168.1.8')).toBe(false);
    expect(isLoopbackHost('sensoura.example')).toBe(false);
  });

  it('blocks known disposable mail domains and their subdomains, not lookalikes', () => {
    expect(isDisposableEmailAddress('member@mailinator.com')).toBe(true);
    expect(isDisposableEmailAddress('member@sub.yopmail.com')).toBe(true);
    expect(isDisposableEmailAddress('member@bankwen.com')).toBe(true);
    expect(isDisposableEmailAddress('member@notmailinator.com')).toBe(false);
    expect(isDisposableEmailAddress('member@example.org')).toBe(false);
  });

  it('uses the development operator token only for a local dev frontend and API', async () => {
    expect(isLocalDevelopmentEnvironment()).toBe(true);
    window.localStorage.setItem(ACCESS_TOKEN_KEY, 'firebase-viewer-token');
    window.localStorage.setItem(EXPIRY_KEY, String(Date.now() + 3_600_000));
    await expect(getFreshAccessToken()).resolves.toBe('dev-token');
  });

  it('keeps the Firebase session token in production builds', async () => {
    vi.stubEnv('DEV', false);
    window.localStorage.setItem(ACCESS_TOKEN_KEY, 'firebase-viewer-token');
    window.localStorage.setItem(EXPIRY_KEY, String(Date.now() + 3_600_000));
    await expect(getFreshAccessToken()).resolves.toBe('firebase-viewer-token');
  });

  it('treats a production Firebase token without a privileged role as read-only', () => {
    vi.stubEnv('DEV', false);
    const claims = window.btoa(JSON.stringify({ firebase: { sign_in_provider: 'google.com' } }));
    window.localStorage.setItem(ACCESS_TOKEN_KEY, `header.${claims}.signature`);
    expect(getAuthorizationRoleHint()).toBe('viewer');
    expect(hasControlAccessHint()).toBe(false);
  });

  it('allows the explicitly local development token to show operator controls', () => {
    vi.stubEnv('DEV', true);
    expect(getAuthorizationRoleHint()).toBe('operator');
    expect(hasControlAccessHint()).toBe(true);
  });
});
