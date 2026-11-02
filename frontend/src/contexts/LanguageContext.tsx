import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getPreferredLanguage, savePreferredLanguage } from '@services/language';
import { translate, type Language, type TranslationKey } from '@services/translations';

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getPreferredLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    savePreferredLanguage(language);
  }, [language]);

  useEffect(() => {
    const handleLanguageChange = (event: Event) => {
      const next = (event as CustomEvent<Language>).detail;
      if (next === 'ar' || next === 'en') setLanguageState(next);
    };
    window.addEventListener('sensoura:language-changed', handleLanguageChange);
    return () => window.removeEventListener('sensoura:language-changed', handleLanguageChange);
  }, []);

  const setLanguage = useCallback((next: Language) => setLanguageState(next), []);
  const toggleLanguage = useCallback(() => setLanguageState((current) => current === 'ar' ? 'en' : 'ar'), []);
  const t = useCallback((key: TranslationKey, values?: Record<string, string | number>) => translate(language, key, values), [language]);

  return <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}
