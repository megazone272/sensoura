import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSensorStore, useAISuggestions } from '@store/sensorStore';
import { signOut } from '@services/authToken';
import { ThemeToggle } from '@components/ThemeToggle';
import { PageMotion } from '@components/Motion';
import { useLanguage } from '@contexts/LanguageContext';
import { Activity, BarChart3, Bell, Brain, CloudSun, Droplets, History, LayoutDashboard, LogOut, Menu, Search, Settings, ShieldCheck, Sprout, Terminal, UserRound, Wifi, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { validTimestamp } from '@services/telemetry';
import { getBackendHealth, getBackendMode } from '@services/backendHealth';
import { getAISuggestionAlertsEnabled } from '@services/notificationPreferences';

const navigation = [
  { path: '/dashboard', label: 'navOverview', icon: LayoutDashboard, group: 'monitor' },
  { path: '/sensors', label: 'navSensors', icon: Activity, group: 'monitor' },
  { path: '/climate', label: 'navClimate', icon: CloudSun, group: 'monitor' },
  { path: '/history', label: 'navHistory', icon: History, group: 'monitor' },
  { path: '/irrigation', label: 'navIrrigation', icon: Droplets, group: 'control' },
  { path: '/commands', label: 'navCommands', icon: Terminal, group: 'control' },
  { path: '/ai-suggestions', label: 'navAI', icon: Brain, group: 'control' },
  { path: '/crop-rotation', label: 'navCropRotation', icon: Sprout, group: 'control' },
  { path: '/health', label: 'navHealth', icon: ShieldCheck, group: 'system' },
  { path: '/settings', label: 'navSettings', icon: Settings, group: 'system' },
] as const;

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const connected = useSensorStore((state) => state.connected);
  const connecting = useSensorStore((state) => state.connecting);
  const error = useSensorStore((state) => state.error);
  const connect = useSensorStore((state) => state.connect);
  const disconnect = useSensorStore((state) => state.disconnect);
  const suggestions = useAISuggestions();
  const { language, toggleLanguage, t } = useLanguage();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [backendMode, setBackendMode] = useState<'sdk' | 'mock' | 'unknown'>('unknown');
  const [aiAlertsEnabled, setAiAlertsEnabled] = useState(getAISuggestionAlertsEnabled);
  const isArabic = language === 'ar';
  const pendingCount = aiAlertsEnabled && backendMode === 'sdk' ? Object.values(suggestions).filter((suggestion) => suggestion.status === 'pending' && (validTimestamp(suggestion.expiresAt) ?? 0) > Date.now()).length : 0;

  useEffect(() => { void connect().catch(() => undefined); return () => disconnect(); }, [connect, disconnect]);
  useEffect(() => {
    let active = true;
    void getBackendHealth().then((health) => {
      if (!active) return;
      setBackendMode(getBackendMode(health));
    }).catch(() => { if (active) setBackendMode('unknown'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const updatePreference = () => setAiAlertsEnabled(getAISuggestionAlertsEnabled());
    window.addEventListener('sensoura:notification-preferences-changed', updatePreference);
    return () => window.removeEventListener('sensoura:notification-preferences-changed', updatePreference);
  }, []);
  useEffect(() => setSidebarOpen(false), [location.pathname]);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const handleSignOut = () => { signOut(); disconnect(); window.dispatchEvent(new Event('sensoura:auth-expired')); navigate('/login', { replace: true }); };
  const connectionLabel = connected ? t('connected') : connecting ? t('connecting') : t('disconnected');
  const connectionTone = connected ? 'online' : connecting ? 'warning' : 'offline';
  const currentPage = navigation.find((item) => item.path === location.pathname);
  const dateTime = new Intl.DateTimeFormat(isArabic ? 'ar-EG' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(now);

  return <div className="sensoura-app-shell">
    {sidebarOpen && <button className="sensoura-sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label={t('menuClose')} />}
    <aside id="sensoura-sidebar" className={`sensoura-sidebar ${sidebarOpen ? 'is-open' : isArabic ? 'is-closed-rtl' : 'is-closed-ltr'}`} aria-label={t('menuOpen')}>
      <div className="sensoura-brand-row"><div className="sensoura-brand-mark"><Sprout aria-hidden="true" /></div><div className="min-w-0 flex-1"><p className="sensoura-brand-name">SENSOURA</p><p className="sensoura-brand-subtitle">{t('mission')}</p></div><button className="sensoura-icon-button lg:hidden" onClick={() => setSidebarOpen(false)} aria-label={t('menuClose')}><X size={18} /></button></div>
      <div className="sensoura-sidebar-tagline">SMART AGRICULTURE <span>·</span> MONITOR · PREDICT · CONTROL</div>
      <nav className="sensoura-nav" aria-label={t('menuOpen')}>
        {(['monitor', 'control', 'system'] as const).map((group) => {
          const groupLabel = group === 'monitor' ? 'groupMonitor' : group === 'control' ? 'groupControl' : 'groupSystem';
          return <div className="sensoura-nav-group" key={group}><p className="sensoura-nav-caption">{t(groupLabel)}</p>{navigation.filter((item) => item.group === group).map(({ path, label, icon: Icon }) => <NavLink key={path} to={path} className={({ isActive }) => `sensoura-nav-link${isActive ? ' is-active' : ''}`}><Icon size={18} aria-hidden="true" /><span>{t(label)}</span>{path === '/ai-suggestions' && pendingCount > 0 && <span className="nav-count">{pendingCount}</span>}</NavLink>)}</div>;
        })}
      </nav>
      <div className="sensoura-sidebar-footer"><div className="sensoura-connection-card" aria-live="polite"><span className={`status-dot ${connectionTone}`} aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[var(--text-primary)]">{connectionLabel}</p><p className="text-xs text-[var(--text-muted)] truncate">{error || (connected ? t('socketStatus') : t('noTelemetry'))}</p></div>{!connected && !connecting && <button className="sensoura-retry-button" onClick={() => void connect().catch(() => undefined)} aria-label={t('retryConnection')}><Wifi size={14} /><span className="hidden sm:inline">{t('retryConnection')}</span></button>}</div><p className="sensoura-team-label"><BarChart3 size={13} /> {t('team')}</p></div>
    </aside>
    <main className="sensoura-main">
      <header className="sensoura-topbar"><div className="topbar-left"><button className="sensoura-icon-button lg:hidden" onClick={() => setSidebarOpen(true)} aria-label={t('menuOpen')} aria-expanded={sidebarOpen} aria-controls="sensoura-sidebar"><Menu size={20} /></button><CommandSearch navigate={navigate} language={language} t={t} /><nav className="topbar-page-context" aria-label={language === 'ar' ? 'مسار الصفحة' : 'Breadcrumb'}><span>{t('brand')}</span><span aria-hidden="true">/</span><strong>{currentPage ? t(currentPage.label) : t('overviewTitle')}</strong></nav></div>
        <div className="topbar-right"><span className={`sensoura-topbar-online ${connected ? 'is-online' : connecting ? 'is-warning' : 'is-offline'}`} title={t('socketStatus')} aria-label={`${t('socketStatus')}: ${connectionLabel}`}><span className={`status-dot ${connectionTone}`} /><span className="topbar-online-label">{connectionLabel}</span></span><span className="topbar-date" title={dateTime}>{dateTime}</span><button className="sensoura-icon-button notification-button" onClick={() => navigate('/ai-suggestions')} aria-label={pendingCount ? `${pendingCount} ${t('pending')} — ${t('navAI')}` : t('navAI')} title={t('navAI')}><Bell size={17} />{pendingCount > 0 && <span className="notification-count">{pendingCount}</span>}</button><span className="topbar-divider" aria-hidden="true" /><button className="sensoura-icon-button profile-button" onClick={() => navigate('/settings')} aria-label={t('sessionTitle')} title={t('sessionTitle')}><UserRound size={17} /></button><button className="sensoura-language-button" onClick={toggleLanguage} aria-label={t('language')} title={t('language')}><span aria-hidden="true">文</span><span>{isArabic ? 'EN' : 'عربي'}</span></button><ThemeToggle language={language} /><button className="sensoura-icon-button signout-button" onClick={handleSignOut} aria-label={t('signOut')} title={t('signOut')}><LogOut size={17} /></button></div>
      </header>
      <div className="sensoura-page-content"><PageMotion key={location.pathname} className="sensoura-page-motion"><Outlet /></PageMotion></div>
    </main>
  </div>;
}

function CommandSearch({ navigate, language, t }: { navigate: (to: string) => void; language: 'ar' | 'en'; t: (key: typeof navigation[number]['label']) => string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const items = useMemo(() => navigation.map((item) => ({ path: item.path, label: t(item.label) })).filter((item) => !query.trim() || item.label.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language))).slice(0, 5), [language, query, t]);
  useEffect(() => { const focusSearch = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(true); inputRef.current?.focus(); } }; window.addEventListener('keydown', focusSearch); return () => window.removeEventListener('keydown', focusSearch); }, []);
  const select = (path: string) => { navigate(path); setQuery(''); setOpen(false); inputRef.current?.blur(); };
  return <div className="topbar-search-wrap"><div className="topbar-search"><Search size={16} aria-hidden="true" /><input ref={inputRef} value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'Enter' && items[0]) select(items[0].path); }} aria-label={language === 'ar' ? 'البحث في صفحات اللوحة' : 'Search dashboard pages'} placeholder={language === 'ar' ? 'ابحث عن صفحة...' : 'Search dashboard...'} /><kbd>Ctrl K</kbd></div>{open && <><button className="search-dismiss" onClick={() => setOpen(false)} aria-label={language === 'ar' ? 'إغلاق البحث' : 'Close search'} /><div className="topbar-search-results" role="listbox">{items.length ? items.map((item) => <button key={item.path} role="option" aria-selected="false" onClick={() => select(item.path)}>{item.label}<span>↵</span></button>) : <p>{language === 'ar' ? 'لا توجد نتائج' : 'No matching pages'}</p>}</div></>}</div>;
}
