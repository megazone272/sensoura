import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Sensors } from './pages/Sensors';
import { Commands } from './pages/Commands';
import { AISuggestions } from './pages/AISuggestions';
import { Settings } from './pages/Settings';
import { NotFound } from './pages/NotFound';
import { ClimateSection } from './components/ClimateSection';
import { Irrigation } from './pages/Irrigation';
import { History } from './pages/History';
import { SystemHealth } from './pages/SystemHealth';
import { trackPageView } from './services/analytics';
import { hasAuthSession } from './services/authToken';
import { ThemeProvider } from './contexts/ThemeContext';
import { LanguageProvider } from './contexts/LanguageContext';

const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

function RouteAnalytics() {
  const { pathname } = useLocation();
  useEffect(() => {
    trackPageView(pathname.split('/').filter(Boolean)[0] || 'landing');
  }, [pathname]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [authorized, setAuthorized] = useState(hasAuthSession);

  useEffect(() => {
    const refreshSessionState = () => setAuthorized(hasAuthSession());
    window.addEventListener('sensoura:auth-expired', refreshSessionState);
    return () => window.removeEventListener('sensoura:auth-expired', refreshSessionState);
  }, []);

  if (!authorized) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <BrowserRouter basename={routerBasename}>
          <RouteAnalytics />
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Login initialMode="sign-up" />} />
            <Route element={<RequireAuth><Layout /></RequireAuth>}>
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="sensors" element={<Sensors />} />
              <Route path="climate" element={<ClimateSection />} />
              <Route path="irrigation" element={<Irrigation />} />
              <Route path="commands" element={<Commands />} />
              <Route path="history" element={<History />} />
              <Route path="ai-suggestions" element={<AISuggestions />} />
              <Route path="health" element={<SystemHealth />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
