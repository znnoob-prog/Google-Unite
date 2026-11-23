import React, { useState } from 'react';
import {
  CheckSquare,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  Moon,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { NavSection } from '../types.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

interface ShellProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onSyncAll: () => void;
  isSyncing: boolean;
  onOpenSearch: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Command Center', sublabel: 'Unified overview', icon: LayoutDashboard },
  { id: 'gemini', label: 'Google Gemini', sublabel: 'AI Copilot · Workspace', icon: Sparkles },
  { id: 'maps', label: 'Maps & Routes', sublabel: 'Places · Directions', icon: MapPin },
  { id: 'communications', label: 'Mail, Cal & Meet', sublabel: 'Gmail · Calendar · Meet', icon: Mail },
  { id: 'drive', label: 'Drive & Editors', sublabel: 'Docs · Sheets · Slides · Forms', icon: FolderOpen },
  { id: 'tasks_keep', label: 'Tasks & Keep', sublabel: 'Tasks · Keep Notes', icon: CheckSquare },
  { id: 'classroom_contacts', label: 'Classroom & Contacts', sublabel: 'Courses · People Directory', icon: GraduationCap },
  { id: 'chat', label: 'Team Chat', sublabel: 'Google Chat · Channels', icon: MessageSquare },
  { id: 'admin', label: 'Central Hub', sublabel: 'Accounts · SQL Audit', icon: Shield },
];

export const Shell: React.FC<ShellProps> = ({
  activeSection,
  onSelectSection,
  darkMode,
  onToggleDarkMode,
  onSyncAll,
  isSyncing,
  onOpenSearch,
  children,
}) => {
  const { dbUser, accessToken, signIn, signOut, wsConnected, onlineUsers, isSigningIn } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeItem = NAV_ITEMS.find((i) => i.id === activeSection) ?? NAV_ITEMS[0];

  const handleNavClick = (section: NavSection) => {
    onSelectSection(section);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 z-30">
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => handleNavClick('overview')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap"
          >
            Google Unite
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{item.label}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {item.sublabel}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums">{onlineUsers.length}</span> online
            </span>
            <span className="font-mono text-[11px]">
              {wsConnected ? 'Live Sync' : 'Reconnecting'}
            </span>
          </div>

          {!accessToken && (
            <GoogleSignInButton
              onClick={() => void signIn(true, false)}
              disabled={isSigningIn}
              label="Connect Google APIs"
              className="w-full !h-9 !text-xs"
            />
          )}

          {dbUser && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  {dbUser.displayName || dbUser.email}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {dbUser.role} · {dbUser.email}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
              <span className="font-display text-base font-bold">Google Unite</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close navigation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.sublabel}
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="min-w-0 text-xs">
                <div className="font-medium truncate">{dbUser?.displayName || dbUser?.email}</div>
                <div className="text-slate-500 dark:text-slate-400">{dbUser?.role}</div>
              </div>
              <button
                type="button"
                onClick={() => void signOut()}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
              >
                Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar Contract: 3 clean zones */}
        <header className="sticky top-0 z-20 h-14 lg:h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 px-4 lg:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                Google Unite
              </span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">/</span>
              <h1 className="font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                {activeItem.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenSearch}
              className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Search SQL Hub</span>
            </button>

            <button
              type="button"
              onClick={onToggleDarkMode}
              className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              aria-label="Toggle theme"
              title="Toggle light or dark theme"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onSyncAll}
              disabled={isSyncing}
              className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Workspace'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>

        <footer className="border-t border-slate-200 dark:border-slate-800 px-4 lg:px-6 py-4">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Google Unite · Centralized Workspace</span>
            <span>Google Unite is unofficial and is not affiliated with Google LLC.</span>
          </div>
        </footer>
      </div>
    </div>
  );
};
