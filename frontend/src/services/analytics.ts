import posthog from 'posthog-js';

/**
 * Product analytics for the mission dashboard (PostHog).
 *
 * An authenticated dashboard user is identified by a stable pseudonymous id
 * kept in localStorage, plus the mission/device context the page is showing. The
 * funnel that matters here is monitoring → command:
 *
 *   $pageview (route) → device_command_sent | ai_suggestion_reviewed
 *
 * Capture is on by default, honours `navigator.doNotTrack`, and can be turned
 * off from Settings → Product analytics (`setAnalyticsConsent('denied')`).
 * Nothing is sent until `VITE_POSTHOG_KEY` is configured; see .env.example.
 */

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';

const DISTINCT_ID_KEY = 'sensoura-analytics-id';
const CONSENT_KEY = 'sensoura-analytics-consent';

export type AnalyticsConsent = 'granted' | 'denied';

let initialized = false;

/** True when a PostHog project key is configured for this build. */
export function isAnalyticsConfigured(): boolean {
  return Boolean(POSTHOG_KEY);
}

/** Stored choice of the dashboard user; granted unless they opted out. */
export function getAnalyticsConsent(): AnalyticsConsent {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'denied' ? 'denied' : 'granted';
  } catch {
    return 'granted';
  }
}

/** Stable pseudonymous per-browser dashboard-user id for funnel analysis. */
function getDistinctId(): string {
  try {
    const existing = localStorage.getItem(DISTINCT_ID_KEY);
    if (existing) return existing;

    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `operator-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    localStorage.setItem(DISTINCT_ID_KEY, id);
    return id;
  } catch {
    return `operator-${Date.now()}`;
  }
}

/** Initialise the SDK once, then identify the dashboard user. Safe to call twice. */
export function initAnalytics(): void {
  if (!POSTHOG_KEY || initialized) return;
  initialized = true;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // Routes are captured from <RouteAnalytics />, one step per screen.
    capture_pageview: false,
    capture_pageleave: true,
    persistence: 'localStorage',
    person_profiles: 'identified_only',
    respect_dnt: true,
    opt_out_capturing_by_default: getAnalyticsConsent() === 'denied',
  });

  identifyOperator();
}

/** Attach mission context to the current dashboard user in PostHog. */
export function identifyOperator(properties: Record<string, unknown> = {}): void {
  if (!initialized) return;

  posthog.identify(getDistinctId(), {
    role: 'dashboard-user',
    mission: 'SENSOURA',
    phase: 'LUNAR_ANALOG',
    ...properties,
  });
}

/** Capture a product event; a no-op when analytics is off or unconfigured. */
export function trackEvent(name: string, properties: Record<string, unknown> = {}): void {
  if (!initialized) return;
  posthog.capture(name, properties);
}

/** Capture a screen view, so each dashboard page is a funnel step. */
export function trackPageView(route: string): void {
  if (!initialized) return;

  posthog.capture('$pageview', {
    route,
    $current_url: typeof window !== 'undefined' ? window.location.href : undefined,
  });
}

/** Persist the operator's choice and apply it to the SDK immediately. */
export function setAnalyticsConsent(consent: AnalyticsConsent): void {
  try {
    localStorage.setItem(CONSENT_KEY, consent);
  } catch {
    // Storage blocked: the choice just isn't remembered across reloads.
  }

  if (!initialized) return;

  if (consent === 'granted') {
    posthog.opt_in_capturing();
  } else {
    posthog.opt_out_capturing();
  }
}
