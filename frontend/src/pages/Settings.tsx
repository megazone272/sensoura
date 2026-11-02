import { useState } from 'react';
import { BarChart3, Bell, Check, Globe2, LogOut, Moon, Palette, Sun, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@contexts/ThemeContext';
import { useLanguage } from '@contexts/LanguageContext';
import { isLocalDevelopmentEnvironment, signOut } from '@services/authToken';
import { getAnalyticsConsent, isAnalyticsConfigured, setAnalyticsConsent, type AnalyticsConsent } from '@services/analytics';
import { getAISuggestionAlertsEnabled, setAISuggestionAlertsEnabled } from '@services/notificationPreferences';

export function Settings() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const [analyticsConsent, setAnalyticsConsentState] = useState<AnalyticsConsent>(getAnalyticsConsent());
  const [aiAlertsEnabled, setAiAlertsEnabled] = useState(getAISuggestionAlertsEnabled);
  const [signingOut, setSigningOut] = useState(false);
  const analyticsConfigured = isAnalyticsConfigured();
  const localOperator = isLocalDevelopmentEnvironment();

  const toggleAnalytics = () => {
    const next: AnalyticsConsent = analyticsConsent === 'granted' ? 'denied' : 'granted';
    setAnalyticsConsent(next);
    setAnalyticsConsentState(next);
  };

  const toggleAISuggestionAlerts = () => {
    const next = !aiAlertsEnabled;
    setAISuggestionAlertsEnabled(next);
    setAiAlertsEnabled(next);
  };

  const handleSignOut = () => {
    setSigningOut(true);
    signOut();
    window.dispatchEvent(new Event('sensoura:auth-expired'));
    navigate('/login', { replace: true });
  };

  return (
    <div className="space-y-7">
      <header className="page-heading" data-motion-item><div><p className="eyebrow">ACCOUNT & PREFERENCES</p><h1>{t('settingsTitle')}</h1><p>{t('settingsSubtitle')}</p></div></header>

      <section className="panel-card" data-motion-item>
        <div className="section-heading compact"><div><p className="eyebrow">PERSONALIZATION</p><h2>{t('appearance')}</h2></div><Palette size={19} className="text-[var(--accent-primary)]" /></div>
        <div className="preferences-grid">
          <div className="preference-copy"><h3>{t('theme')}</h3><p>{language === 'ar' ? 'اختر المظهر الذي يناسبك. يُحفظ اختيارك على هذا المتصفح.' : 'Choose your preferred appearance. The selection is saved in this browser.'}</p></div>
          <div className="segmented-control" role="group" aria-label={t('theme')}>
            <button className={theme === 'dark' ? 'is-selected' : ''} onClick={() => theme !== 'dark' && toggleTheme()} aria-pressed={theme === 'dark'}><Moon size={16} />{t('darkMode')}{theme === 'dark' && <Check size={14} />}</button>
            <button className={theme === 'light' ? 'is-selected' : ''} onClick={() => theme !== 'light' && toggleTheme()} aria-pressed={theme === 'light'}><Sun size={16} />{t('lightMode')}{theme === 'light' && <Check size={14} />}</button>
          </div>
        </div>
        <div className="preferences-grid border-top">
          <div className="preference-copy"><h3>{t('language')}</h3><p>{language === 'ar' ? 'يُطبّق اختيار اللغة على كامل اللوحة واتجاه الصفحة.' : 'Language selection applies across the dashboard and document direction.'}</p></div>
          <div className="segmented-control" role="group" aria-label={t('language')}>
            <button className={language === 'ar' ? 'is-selected' : ''} onClick={() => setLanguage('ar')} aria-pressed={language === 'ar'}><Globe2 size={16} />العربية{language === 'ar' && <Check size={14} />}</button>
            <button className={language === 'en' ? 'is-selected' : ''} onClick={() => setLanguage('en')} aria-pressed={language === 'en'}><Globe2 size={16} />English{language === 'en' && <Check size={14} />}</button>
          </div>
        </div>
        <div className="preferences-grid border-top">
          <div className="preference-copy"><h3>{t('notificationsTitle')}</h3><p>{t('notificationsDescription')}</p></div>
          <button className="btn btn-secondary" onClick={toggleAISuggestionAlerts} aria-pressed={aiAlertsEnabled}><Bell size={16} />{aiAlertsEnabled ? t('notificationsEnabled') : t('notificationsDisabled')}</button>
        </div>
      </section>

      <section className="panel-card" data-motion-item>
        <div className="section-heading compact"><div><p className="eyebrow">IDENTITY</p><h2>{t('sessionTitle')}</h2></div><UserRound size={19} className="text-[var(--accent-primary)]" /></div>
        <div className="account-session-row"><span className="session-dot" /><div><strong>{t('sessionActive')}</strong><p className="microcopy">{language === 'ar' ? 'جلسة Firebase نشطة لهذا المتصفح.' : 'A Firebase session is active for this browser.'}</p></div><button className="btn btn-secondary" onClick={handleSignOut} disabled={signingOut}><LogOut size={16} />{t('signOut')}</button></div>
        {localOperator ? <p className="status-banner is-warning mt-4" role="note">{t('localOperator')}</p> : <p className="status-banner is-info mt-4" role="note">{t('productionViewer')}</p>}
      </section>

      <section className="panel-card" data-motion-item>
        <div className="section-heading compact"><div><p className="eyebrow">PRIVACY</p><h2>{t('analyticsTitle')}</h2></div><BarChart3 size={19} className="text-[var(--accent-primary)]" /></div>
        <p className="microcopy mb-4">{t('analyticsDescription')}</p>
        <div className="account-session-row">
          <div><strong>{analyticsConsent === 'granted' ? t('analyticsOn') : analyticsConsent === 'denied' ? t('analyticsOff') : t('analyticsOff')}</strong><p className="microcopy">{analyticsConfigured ? '' : t('analyticsMissing')}</p></div>
          <button className="btn btn-secondary" onClick={toggleAnalytics} disabled={!analyticsConfigured}>{analyticsConsent === 'granted' ? t('optOut') : t('optIn')}</button>
        </div>
      </section>
    </div>
  );
}
