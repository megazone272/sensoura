const ACCESS_TOKEN_KEY = 'sensoura-token';
const REFRESH_TOKEN_KEY = 'sensoura-refresh-token';
const TOKEN_EXPIRY_KEY = 'sensoura-token-expires-at';
const FIREBASE_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY?.trim() ?? '';
const FIREBASE_AUTH_DOMAIN = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ?? '';
const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() ?? '';
type FirebaseAuthSdk = typeof import('firebase/auth');
let socialAuthInstance: import('firebase/auth').Auth | null = null;
let socialAuthSdk: FirebaseAuthSdk | null = null;

type FirebaseTokenResponse = {
  idToken?: string;
  refreshToken?: string;
  expiresIn?: string;
  error?: { message?: string };
};

const disposableEmailDomains = new Set([
  '10minutemail.com', '10minutemail.net', 'bankwen.com', 'dispostable.com', 'dropmail.me', 'emailondeck.com',
  'fakeinbox.com', 'getnada.com', 'guerrillamail.com', 'guerrillamail.net', 'inboxkitten.com',
  'mailcatch.com', 'maildrop.cc', 'mailinator.com', 'mailnesia.com', 'mintemail.com', 'mohmal.com',
  'sharklasers.com', 'temp-mail.org', 'tempail.com', 'tempmail.com', 'tempmailo.com',
  'throwawaymail.com', 'trashmail.com', 'yopmail.com',
]);

export function isDisposableEmailAddress(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const separator = normalized.lastIndexOf('@');
  if (separator < 1) return false;
  const domain = normalized.slice(separator + 1).replace(/\.$/, '');
  return Array.from(disposableEmailDomains).some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function isFirebaseEmailVerified(idToken: string): boolean {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return false;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const bytes = Uint8Array.from(window.atob(padded), (character) => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as {
      email_verified?: unknown;
    };
    return claims.email_verified === true;
  } catch {
    return false;
  }
}

async function sendFirebaseVerificationLink(idToken: string): Promise<void> {
  const apiBase = import.meta.env.VITE_API_URL?.trim() ?? '';
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/auth/email-verification/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    throw new Error('Email verification service is unavailable');
  }
  const data = await response.json().catch(() => ({})) as { error?: string; retryAfterSeconds?: number; sent?: boolean };
  if (!response.ok) throw new Error(data.error ?? 'Verification link could not be sent');
  if (data.sent === false) throw new Error(`Verification email cooldown active. Retry in ${data.retryAfterSeconds ?? 60} seconds`);
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function isLocalDevelopmentEnvironment(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  if (!isLoopbackHost(window.location.hostname)) return false;
  const apiUrl = import.meta.env.VITE_API_URL?.trim();
  if (!apiUrl) return true;
  try {
    return isLoopbackHost(new URL(apiUrl, window.location.origin).hostname);
  } catch {
    return false;
  }
}

function getDevelopmentToken(): string | null {
  if (!isLocalDevelopmentEnvironment()) return null;
  return import.meta.env.VITE_DEV_AUTH_TOKEN?.trim() || 'dev-token';
}

function readLocal(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(TOKEN_EXPIRY_KEY);
    window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
  if (socialAuthInstance && socialAuthSdk) {
    const auth = socialAuthInstance;
    const sdk = socialAuthSdk;
    socialAuthInstance = null;
    socialAuthSdk = null;
    void sdk.signOut(auth).catch(() => undefined);
  }
}

export function expireAuthSession(): void {
  clearAuthSession();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sensoura:auth-expired'));
  }
}

function storeTokens(idToken: string, refreshToken: string, expiresIn: string): void {
  if (typeof window === 'undefined') throw new Error('Browser storage is unavailable');
  try {
    const expiresAt = Date.now() + Number(expiresIn) * 1000;
    window.localStorage.setItem(ACCESS_TOKEN_KEY, idToken);
    window.localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));
    window.sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } catch {
    throw new Error('The browser could not store the Firebase session');
  }
}

export function hasAuthSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(
      window.localStorage.getItem(ACCESS_TOKEN_KEY) ||
      window.sessionStorage.getItem(REFRESH_TOKEN_KEY),
    );
  } catch {
    return false;
  }
}

export type AuthorizationRoleHint = 'admin' | 'operator' | 'viewer' | 'unknown';

/** UI hint only: every privileged request is still authorized by the backend. */
export function getAuthorizationRoleHint(): AuthorizationRoleHint {
  if (getDevelopmentToken()) return 'operator';
  const token = readLocal(ACCESS_TOKEN_KEY);
  if (!token) return 'unknown';
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return 'viewer';
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const claims = JSON.parse(window.atob(padded)) as { role?: unknown };
    if (claims.role === 'admin' || claims.role === 'operator' || claims.role === 'viewer') return claims.role;
    return 'viewer';
  } catch {
    return 'viewer';
  }
}

export function hasControlAccessHint(): boolean {
  const role = getAuthorizationRoleHint();
  return role === 'admin' || role === 'operator';
}

export function getAccessToken(): string | null {
  const storedToken = readLocal(ACCESS_TOKEN_KEY)?.trim();
  return getDevelopmentToken() || storedToken || null;
}

export async function getFreshAccessToken(): Promise<string | null> {
  const developmentToken = getDevelopmentToken();
  if (developmentToken) return developmentToken;
  const storedToken = readLocal(ACCESS_TOKEN_KEY)?.trim();
  const expiresAt = Number(readLocal(TOKEN_EXPIRY_KEY) ?? 0);
  if (storedToken && expiresAt > Date.now() + 60_000) return storedToken;
  let refreshToken: string | null = null;
  try {
    refreshToken = typeof window === 'undefined'
      ? null
      : window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    refreshToken = null;
  }

  if (!refreshToken || !FIREBASE_API_KEY) {
    if (storedToken) expireAuthSession();
    return getDevelopmentToken();
  }

  try {
    const response = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      },
    );
    const data = await response.json() as {
      id_token?: string;
      refresh_token?: string;
      expires_in?: string;
    };

    if (!response.ok || !data.id_token || !data.refresh_token || !data.expires_in) {
      expireAuthSession();
      return getDevelopmentToken();
    }

    storeTokens(data.id_token, data.refresh_token, data.expires_in);
    return data.id_token;
  } catch {
    expireAuthSession();
    return getDevelopmentToken();
  }
}

export async function signInWithEmailPassword(email: string, password: string): Promise<void> {
  if (!FIREBASE_API_KEY) {
    throw new Error('Firebase sign-in is not configured. Set VITE_FIREBASE_API_KEY for this build.');
  }
  if (isDisposableEmailAddress(email)) throw new Error('Disposable email addresses are not allowed');

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const data = await response.json() as FirebaseTokenResponse;
  if (!response.ok || !data.idToken || !data.refreshToken || !data.expiresIn) {
    const code = data.error?.message ?? '';
    if (['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(code)) {
      throw new Error('Email or password is incorrect');
    }
    if (code === 'USER_DISABLED') throw new Error('This account has been disabled');
    if (code === 'OPERATION_NOT_ALLOWED') throw new Error('Email/password sign-in is not enabled in Firebase');
    if (code === 'API_KEY_INVALID') throw new Error('The Firebase Web API key is invalid');
    throw new Error('Firebase sign-in failed. Check the account and project configuration.');
  }

  if (!isFirebaseEmailVerified(data.idToken)) {
    clearAuthSession();
    await sendFirebaseVerificationLink(data.idToken);
    throw new Error('Email is not verified');
  }

  storeTokens(data.idToken, data.refreshToken, data.expiresIn);
}

export async function signUpWithEmailPassword(email: string, password: string): Promise<void> {
  if (!FIREBASE_API_KEY) {
    throw new Error('Firebase sign-up is not configured. Set VITE_FIREBASE_API_KEY for this build.');
  }
  if (isDisposableEmailAddress(email)) throw new Error('Disposable email addresses are not allowed');
  if (password.length < 6) throw new Error('Use a password with at least 6 characters');

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
    },
  );
  const data = await response.json() as FirebaseTokenResponse;
  if (!response.ok || !data.idToken || !data.refreshToken || !data.expiresIn) {
    const code = data.error?.message ?? '';
    if (code === 'EMAIL_EXISTS') throw new Error('An account with this email already exists');
    if (code === 'INVALID_EMAIL') throw new Error('Enter a valid email address');
    if (code.startsWith('WEAK_PASSWORD')) throw new Error('Use a stronger password with at least 6 characters');
    if (code === 'OPERATION_NOT_ALLOWED') throw new Error('Email/password account creation is not enabled in Firebase');
    if (code === 'API_KEY_INVALID') throw new Error('The Firebase Web API key is invalid');
    throw new Error('Account creation failed. Check the email and Firebase project configuration.');
  }

  clearAuthSession();
  await sendFirebaseVerificationLink(data.idToken);
}

export async function resendFirebaseVerificationLink(email: string, password: string): Promise<void> {
  if (!FIREBASE_API_KEY) {
    throw new Error('Firebase sign-in is not configured. Set VITE_FIREBASE_API_KEY for this build.');
  }
  if (isDisposableEmailAddress(email)) throw new Error('Disposable email addresses are not allowed');

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password, returnSecureToken: true }),
    },
  );
  const data = await response.json() as FirebaseTokenResponse;
  if (!response.ok || !data.idToken) {
    const code = data.error?.message ?? '';
    if (['INVALID_LOGIN_CREDENTIALS', 'EMAIL_NOT_FOUND', 'INVALID_PASSWORD'].includes(code)) {
      throw new Error('Email or password is incorrect');
    }
    throw new Error('Could not sign in to resend the verification link');
  }

  if (isFirebaseEmailVerified(data.idToken)) throw new Error('Email is already verified');
  clearAuthSession();
  await sendFirebaseVerificationLink(data.idToken);
}

async function signInWithSocialProvider(providerName: 'GitHub' | 'Google'): Promise<void> {
  if (!FIREBASE_API_KEY || !FIREBASE_AUTH_DOMAIN || !FIREBASE_PROJECT_ID) {
    throw new Error(`Firebase ${providerName} sign-in is not configured. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, and VITE_FIREBASE_PROJECT_ID for this build.`);
  }

  const [appSdk, authSdk] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
  ]);
  const appName = 'sensoura-github-auth';
  const app = appSdk.getApps().find((candidate) => candidate.name === appName)
    ?? appSdk.initializeApp({
      apiKey: FIREBASE_API_KEY,
      authDomain: FIREBASE_AUTH_DOMAIN,
      projectId: FIREBASE_PROJECT_ID,
    }, appName);
  const auth = authSdk.getAuth(app);
  socialAuthInstance = auth;
  socialAuthSdk = authSdk;
  await authSdk.setPersistence(auth, authSdk.browserSessionPersistence);

  const provider = providerName === 'GitHub'
    ? new authSdk.GithubAuthProvider()
    : new authSdk.GoogleAuthProvider();
  let result: Awaited<ReturnType<typeof authSdk.signInWithPopup>>;
  try {
    result = await authSdk.signInWithPopup(auth, provider);
  } catch (cause) {
    const code = typeof cause === 'object' && cause !== null && 'code' in cause
      ? String((cause as { code?: unknown }).code ?? '')
      : '';
    if (code === 'auth/popup-closed-by-user') throw new Error(`${providerName} sign-in was cancelled`);
    if (code === 'auth/popup-blocked') throw new Error(`${providerName} sign-in popup was blocked`);
    if (code === 'auth/unauthorized-domain') throw new Error('This domain is not authorized for OAuth sign-in');
    if (code === 'auth/operation-not-allowed') throw new Error(`${providerName} sign-in is not enabled in Firebase`);
    if (code === 'auth/account-exists-with-different-credential') {
      throw new Error('An account with this email already exists with a different sign-in method');
    }
    throw new Error(`${providerName} sign-in failed. Check the Firebase provider configuration.`);
  }

  const idToken = await result.user.getIdToken();
  const tokenResult = await result.user.getIdTokenResult();
  const expiresIn = Math.floor((Date.parse(tokenResult.expirationTime) - Date.now()) / 1000);
  if (!result.user.refreshToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    clearAuthSession();
    throw new Error('OAuth sign-in did not return a valid Firebase session');
  }
  if (!result.user.email) {
    clearAuthSession();
    throw new Error('A verified email address is required');
  }
  if (isDisposableEmailAddress(result.user.email)) {
    clearAuthSession();
    throw new Error('Disposable email addresses are not allowed');
  }
  if (tokenResult.claims.email_verified !== true) {
    clearAuthSession();
    throw new Error('OAuth provider email is not verified');
  }
  try {
    storeTokens(idToken, result.user.refreshToken, String(expiresIn));
  } catch (cause) {
    clearAuthSession();
    throw cause;
  }
}

export function signInWithGitHub(): Promise<void> {
  return signInWithSocialProvider('GitHub');
}

export function signInWithGoogle(): Promise<void> {
  return signInWithSocialProvider('Google');
}

export function signOut(): void {
  clearAuthSession();
}
