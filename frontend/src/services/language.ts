export type Language = 'ar' | 'en';

const LANGUAGE_KEY = 'sensoura-language';

export function getPreferredLanguage(): Language {
  if (typeof window === 'undefined') return 'ar';
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

export function savePreferredLanguage(language: Language): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // The interface still works with the current in-memory language choice.
  }
  window.dispatchEvent(new CustomEvent<Language>('sensoura:language-changed', { detail: language }));
}
