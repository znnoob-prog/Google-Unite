import React from 'react';
import {
  Calendar,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  FolderSearch,
  GraduationCap,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Presentation,
  StickyNote,
  CheckSquare,
  Users,
  Video,
  ClipboardList,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

const INTEGRATIONS = [
  { name: 'Google Gemini', desc: 'Workspace-grounded AI synthesis and action planning', icon: Sparkles },
  { name: 'Google Maps', desc: 'Interactive routing, place autocomplete & shared team pins', icon: MapPin },
  { name: 'Google Drive', desc: 'Unified file browser and live document indexing', icon: FolderOpen },
  { name: 'Google Docs', desc: 'Structured document viewer and batch updates', icon: FileText },
  { name: 'Google Sheets', desc: 'Live multi-tab spreadsheets and SQL cell sync', icon: FileSpreadsheet },
  { name: 'Google Slides', desc: 'Presentation deck outline and slide management', icon: Presentation },
  { name: 'Google Forms', desc: 'Form builder and centralized response analytics', icon: ClipboardList },
  { name: 'Gmail', desc: 'Split-pane inbox, message search & verified send', icon: Mail },
  { name: 'Google Calendar', desc: 'Agenda timeline with linked locations and meetings', icon: Calendar },
  { name: 'Google Meet', desc: 'Instant video space creation and session history', icon: Video },
  { name: 'Google Tasks', desc: 'Prioritized checklists synced across devices', icon: CheckSquare },
  { name: 'Google Keep', desc: 'Collaborative pinned notes, checklists & enterprise Keep sync', icon: StickyNote },
  { name: 'Google Classroom', desc: 'Courses, coursework assignments, announcements & materials', icon: GraduationCap },
  { name: 'Google Picker', desc: 'Interactive Drive file selector with Firestore bookmarks', icon: FolderSearch },
  { name: 'Google Contacts', desc: 'People directory, connections & shared contact cards', icon: Users },
  { name: 'Google Chat', desc: 'Real-time WebSocket channels and Workspace sync', icon: MessageSquare },
];

export const AuthGate: React.FC = () => {
  const { signIn, isSigningIn, authError } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            Google Unite
          </span>
          <div className="hidden md:flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
            <span className="whitespace-nowrap shrink-0">16 Integrated Services</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap shrink-0">Cloud SQL &amp; Firebase</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap shrink-0">Real-Time Sync</span>
          </div>
          <div className="shrink-0">
            <GoogleSignInButton
              onClick={() => void signIn(true, false)}
              disabled={isSigningIn}
              label={isSigningIn ? 'Signing in...' : 'Sign in with Google'}
            />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full px-6 py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-5 space-y-6">
          <p className="text-xs font-medium tracking-wide uppercase text-blue-600 dark:text-blue-400">
            Unified Workspace, AI &amp; Geospatial Operations
          </p>
          <h1 className="font-display text-4xl lg:text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance leading-[1.12]">
            All your Google tools and Gemini, in one synchronized SQL center.
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
            Google Unite brings together Google Gemini, Drive, Picker, Docs, Sheets, Slides, Forms,
            Gmail, Calendar, Meet, Tasks, Keep, Classroom, Contacts, Chat, and Google Maps backed by
            Cloud SQL, Firebase Firestore, and real-time multi-device synchronization.
          </p>

          <div className="pt-2 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <GoogleSignInButton
                onClick={() => void signIn(true, false)}
                disabled={isSigningIn}
                label={isSigningIn ? 'Connecting Workspace...' : 'Sign in with Google & Workspace'}
              />
              <button
                type="button"
                onClick={() => void signIn(false, false)}
                disabled={isSigningIn}
                className="h-11 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                Basic Sign-In Only
              </button>
            </div>

            {authError && (
              <div className="p-3.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
                {authError}
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 pt-1">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>
                Secured by Firebase Authentication · OAuth access tokens remain strictly in memory
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {INTEGRATIONS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.name}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col gap-2"
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400">
                    <Icon className="w-4 h-4" />
                  </div>
                  <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {item.name}
                  </h2>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {item.desc}
                </p>
              </div>
            );
          })}
        </div>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-5 px-6">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Google Unite · Centralized SQL Workspace Platform</span>
          <span>Google Unite is unofficial and is not affiliated with Google LLC.</span>
        </div>
      </footer>
    </div>
  );
};
