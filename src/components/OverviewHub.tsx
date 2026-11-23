import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Calendar,
  CheckSquare,
  FolderOpen,
  Mail,
  MapPin,
  MessageSquare,
  RefreshCw,
  Sparkles,
  StickyNote,
  Video,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import {
  CalendarEventRecord,
  MailMessageRecord,
  MapLocationRecord,
  MeetSessionRecord,
  NavSection,
  NoteRecord,
  PlatformStats,
  TaskRecord,
  WorkspaceRecord,
} from '../types.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

interface OverviewResponse {
  stats: PlatformStats;
  recentRecords: WorkspaceRecord[];
  upcomingEvents: CalendarEventRecord[];
  recentMails: MailMessageRecord[];
  pendingTasks: TaskRecord[];
  pinnedNotes: NoteRecord[];
  mapLocations: MapLocationRecord[];
  meetSessions: MeetSessionRecord[];
}

interface Props {
  onNavigate: (section: NavSection) => void;
  onSyncAll: () => void;
  isSyncing: boolean;
  syncStatusMessage: string | null;
}

export const OverviewHub: React.FC<Props> = ({
  onNavigate,
  onSyncAll,
  isSyncing,
  syncStatusMessage,
}) => {
  const { apiFetch, accessToken, signIn, isSigningIn, lastSyncEvent, dbUser } = useAuth();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setError(null);
      const res = await apiFetch<OverviewResponse>('/api/overview');
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Unable to load command center data.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (lastSyncEvent) {
      void loadOverview();
    }
  }, [lastSyncEvent, loadOverview]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-72 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const stats = data?.stats;

  return (
    <div className="space-y-6">
      {/* Connection & Sync Action Strip */}
      <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
            Welcome back, {dbUser?.displayName || dbUser?.email}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {accessToken
              ? 'Google Workspace, Gemini & Firebase connected · All 16 modules synchronize in real time.'
              : 'Your Cloud SQL & Firebase hub is active. Reconnect Google OAuth anytime to sync Drive, Picker, Docs, Sheets, Slides, Forms, Gmail, Calendar, Tasks, Keep, Classroom, and Contacts.'}
          </p>
          {syncStatusMessage && (
            <p className="text-xs text-blue-600 dark:text-blue-400 pt-1">{syncStatusMessage}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('gemini')}
            className="h-10 px-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>Ask Gemini</span>
          </button>
          {!accessToken ? (
            <GoogleSignInButton
              onClick={() => void signIn(true, false)}
              disabled={isSigningIn}
              label="Connect Google Workspace"
            />
          ) : (
            <button
              type="button"
              onClick={onSyncAll}
              disabled={isSyncing}
              className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing Google APIs...' : 'Sync All Services'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* KPI Row — Tabular Figures */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-3">
        {[
          { label: 'Gemini Threads', value: stats?.geminiThreads ?? 0, target: 'gemini' as NavSection },
          { label: 'Drive & Picker', value: stats?.workspaceRecords ?? 0, target: 'drive' as NavSection },
          { label: 'Calendar Events', value: stats?.calendarEvents ?? 0, target: 'communications' as NavSection },
          { label: 'Gmail Messages', value: stats?.mailMessages ?? 0, target: 'communications' as NavSection },
          { label: 'Tasks', value: stats?.tasks ?? 0, target: 'tasks_keep' as NavSection },
          { label: 'Keep Notes', value: stats?.notes ?? 0, target: 'tasks_keep' as NavSection },
          { label: 'Classroom', value: stats?.classroomCourses ?? 0, target: 'classroom_contacts' as NavSection },
          { label: 'Contacts', value: stats?.contacts ?? 0, target: 'classroom_contacts' as NavSection },
          { label: 'Saved Locations', value: stats?.mapLocations ?? 0, target: 'maps' as NavSection },
        ].map((metric) => (
          <button
            key={metric.label}
            type="button"
            onClick={() => onNavigate(metric.target)}
            className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-left hover:border-blue-400 dark:hover:border-blue-600 transition-colors"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{metric.label}</div>
            <div className="mt-1.5 font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
              {metric.value}
            </div>
          </button>
        ))}
      </div>

      {/* Main 3-Column Bento Grid across all 12 services */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Drive, Docs, Sheets, Slides, Forms */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="font-display text-sm font-semibold">Drive, Docs, Sheets, Slides &amp; Forms</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('drive')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 whitespace-nowrap"
            >
              Open <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
            {(data?.recentRecords ?? []).length === 0 ? (
              <div className="p-6 text-center space-y-2">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No Drive, Docs, Sheets, Slides, or Forms synced yet.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('drive')}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Create or Sync First Document
                </button>
              </div>
            ) : (
              data!.recentRecords.slice(0, 6).map((rec) => (
                <button
                  key={rec.id}
                  type="button"
                  onClick={() => onNavigate('drive')}
                  className="w-full px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {rec.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <span className="capitalize">{rec.service}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{new Date(rec.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        {/* Calendar & Meet + Gmail */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="font-display text-sm font-semibold">Calendar, Gmail &amp; Meet</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('communications')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 whitespace-nowrap"
            >
              Open <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
            {(data?.upcomingEvents ?? []).slice(0, 3).map((ev) => (
              <div key={`ev-${ev.id}`} className="px-5 py-3 space-y-0.5">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {ev.title}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-mono">
                  <span>{new Date(ev.startTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  {ev.meetLink && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-blue-600 dark:text-blue-400 inline-flex items-center gap-1">
                        <Video className="w-3 h-3" /> Meet
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
            {(data?.recentMails ?? []).slice(0, 3).map((mail) => (
              <div key={`mail-${mail.id}`} className="px-5 py-3 space-y-0.5">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{mail.subject}</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {mail.fromEmail} · {mail.isUnread ? 'Unread' : 'Read'}
                </div>
              </div>
            ))}
            {(data?.upcomingEvents?.length ?? 0) === 0 && (data?.recentMails?.length ?? 0) === 0 && (
              <div className="p-6 text-center space-y-2">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No Calendar events or Gmail threads synced yet.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('communications')}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Open Mail, Calendar &amp; Meet
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Tasks, Keep Notes, Maps & Chat */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="font-display text-sm font-semibold">Tasks, Keep Notes &amp; Locations</h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('tasks_keep')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 whitespace-nowrap"
            >
              Open <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
            {(data?.pendingTasks ?? []).slice(0, 3).map((t) => (
              <div key={`task-${t.id}`} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {t.title}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Task · {t.status === 'completed' ? 'Completed' : 'Active'} · {t.priority}
                  </div>
                </div>
              </div>
            ))}
            {(data?.pinnedNotes ?? []).slice(0, 2).map((n) => (
              <div key={`note-${n.id}`} className="px-5 py-3">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
                  <StickyNote className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="truncate">{n.title || 'Untitled Note'}</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {n.content || `${n.checklist.length} checklist items`}
                </div>
              </div>
            ))}
            {(data?.mapLocations ?? []).slice(0, 2).map((loc) => (
              <button
                key={`loc-${loc.id}`}
                type="button"
                onClick={() => onNavigate('maps')}
                className="w-full px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate">{loc.name}</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {loc.address}
                </div>
              </button>
            ))}
            {(data?.pendingTasks?.length ?? 0) === 0 &&
              (data?.pinnedNotes?.length ?? 0) === 0 &&
              (data?.mapLocations?.length ?? 0) === 0 && (
                <div className="p-6 text-center space-y-2">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Add tasks, Keep notes, or Map locations to populate this view.
                  </p>
                  <div className="flex items-center justify-center gap-3 text-xs font-medium text-blue-600 dark:text-blue-400">
                    <button type="button" onClick={() => onNavigate('tasks_keep')} className="hover:underline">
                      Tasks &amp; Keep
                    </button>
                    <span>·</span>
                    <button type="button" onClick={() => onNavigate('maps')} className="hover:underline">
                      Maps
                    </button>
                    <span>·</span>
                    <button type="button" onClick={() => onNavigate('chat')} className="hover:underline inline-flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> Chat
                    </button>
                  </div>
                </div>
              )}
          </div>
        </section>
      </div>
    </div>
  );
};
