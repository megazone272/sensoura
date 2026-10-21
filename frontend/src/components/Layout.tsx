import { Outlet, NavLink } from 'react-router-dom';
import { useSensorStore } from '@store/sensorStore';
import {
  LayoutDashboard,
  Activity,
  Terminal,
  Brain,
  Settings,
  WifiOff,
  Menu,
  X,
} from 'lucide-react';
import { useState, useEffect } from 'react';

const navigation = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/sensors', label: 'Sensors', icon: Activity },
  { path: '/commands', label: 'Commands', icon: Terminal },
  { path: '/ai-suggestions', label: 'AI Suggestions', icon: Brain },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function Layout() {
  const { connected, connecting, error, connect, disconnect } = useSensorStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Auto-connect on mount
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  if (!mounted) return null;

  return (
    <div className="flex h-screen bg-[var(--bg-primary)]">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static z-50 w-[var(--sidebar-width)] h-full
          bg-[var(--bg-secondary)] border-r border-[var(--border-primary)]
          flex flex-col transition-transform duration-300 ease-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        role="navigation"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-[var(--header-height)] px-6 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-primary)] flex items-center justify-center shadow-sm">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight text-[var(--text-primary)]">SENSOURA</h1>
              <p className="text-xs text-[var(--text-muted)] font-mono">LUNAR_ANALOG</p>
            </div>
          </div>
          <button
            className="lg:hidden p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto" role="list">
          {navigation.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => `
                flex items-center gap-3 px-4 py-3 rounded-xl
                text-[var(--text-secondary)] hover:text-[var(--text-primary)]
                hover:bg-[var(--bg-tertiary)] transition-all duration-200
                ${isActive
                  ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30'
                  : ''}
              `}
              role="listitem"
            >
              <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
              <span className="font-medium">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Connection status */}
        <div className="p-4 border-t border-[var(--border-primary)]">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-tertiary)]">
            <div className={`
              status-dot ${connected ? 'online' : connecting ? 'warning' : 'offline'}
            `} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected'}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {error || (connected ? 'Real-time sync active' : 'Attempting reconnection...')}
              </p>
            </div>
            {!connected && !connecting && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => connect()}
                disabled={connecting}
              >
                <WifiOff className="w-4 h-4" />
                Retry
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 lg:ml-[var(--sidebar-width)] flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-[var(--header-height)] px-6 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/80 backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center justify-between h-full">
            <button
              className="lg:hidden p-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </button>

            <div className="flex-1 lg:flex-none" />

            <div className="flex items-center gap-4">
              {/* Mission info */}
              <div className="hidden md:flex items-center gap-4 text-right">
                <div className="text-xs text-[var(--text-muted)] font-mono">
                  TEAM-MISSION-49
                </div>
                <div className="w-px h-6 bg-[var(--border-primary)]" />
                <div className="text-xs font-medium text-[var(--accent-primary)] font-mono">
                  SENSOURA v2.0
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 p-6 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}