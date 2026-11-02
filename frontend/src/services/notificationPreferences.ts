const AI_ALERTS_KEY = 'sensoura.ai-suggestion-alerts';

export function getAISuggestionAlertsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(AI_ALERTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAISuggestionAlertsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(AI_ALERTS_KEY, enabled ? 'on' : 'off');
  } catch {
    // Keep the setting usable in memory-restricted/private browsing contexts.
  }
  window.dispatchEvent(new Event('sensoura:notification-preferences-changed'));
}
