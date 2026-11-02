import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The SDK is replaced so the service can be tested without network or a key.
const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  capture: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

async function loadAnalytics(key = 'phc_test_key') {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_KEY', key);
  return import('@services/analytics');
}

describe('analytics service', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('initialises PostHog once and identifies the dashboard user without exposing a control role', async () => {
    const { initAnalytics } = await loadAnalytics();

    initAnalytics();
    initAnalytics();

    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test_key',
      expect.objectContaining({ capture_pageview: false, respect_dnt: true })
    );
    expect(posthogMock.identify).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ role: 'dashboard-user', mission: 'SENSOURA' })
    );
  });

  it('keeps the same operator id across reloads', async () => {
    const first = await loadAnalytics();
    first.initAnalytics();
    const firstId = posthogMock.identify.mock.calls[0][0];

    const second = await loadAnalytics();
    second.initAnalytics();
    const secondId = posthogMock.identify.mock.calls[1][0];

    expect(secondId).toBe(firstId);
  });

  it('captures product events and route views', async () => {
    const { initAnalytics, trackEvent, trackPageView } = await loadAnalytics();
    initAnalytics();

    trackEvent('device_command_sent', { target: 'pump', action: 'ON', mode: 'MANUAL' });
    trackPageView('commands');

    expect(posthogMock.capture).toHaveBeenCalledWith('device_command_sent', {
      target: 'pump',
      action: 'ON',
      mode: 'MANUAL',
    });
    expect(posthogMock.capture).toHaveBeenCalledWith(
      '$pageview',
      expect.objectContaining({ route: 'commands' })
    );
  });

  it('applies an opt-out immediately and for the next load', async () => {
    const { initAnalytics, setAnalyticsConsent, getAnalyticsConsent } = await loadAnalytics();
    initAnalytics();

    setAnalyticsConsent('denied');

    expect(posthogMock.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(getAnalyticsConsent()).toBe('denied');

    const reloaded = await loadAnalytics();
    reloaded.initAnalytics();
    expect(posthogMock.init).toHaveBeenLastCalledWith(
      'phc_test_key',
      expect.objectContaining({ opt_out_capturing_by_default: true })
    );
  });

  it('stays inert without a project key', async () => {
    const { initAnalytics, isAnalyticsConfigured, trackEvent } = await loadAnalytics('');

    initAnalytics();
    trackEvent('device_command_sent', { target: 'pump' });

    expect(isAnalyticsConfigured()).toBe(false);
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });
});
