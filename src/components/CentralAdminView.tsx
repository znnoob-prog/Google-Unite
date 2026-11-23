import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Shield, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { AuditLogRecord, DbUser, PlatformStats } from '../types.ts';

export const CentralAdminView: React.FC = () => {
  const { apiFetch, dbUser, onlineUsers, lastSyncEvent } = useAuth();
  const [usersList, setUsersList] = useState<DbUser[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAdminData = useCallback(async () => {
    try {
      setError(null);
      const [usersRes, logsRes, overviewRes] = await Promise.all([
        apiFetch<{ users: DbUser[]; isAdmin: boolean }>('/api/admin/users'),
        apiFetch<{ logs: AuditLogRecord[] }>('/api/admin/logs'),
        apiFetch<{ stats: PlatformStats }>('/api/overview'),
      ]);
      setUsersList(usersRes.users);
      setIsAdmin(usersRes.isAdmin);
      setLogs(logsRes.logs);
      setStats(overviewRes.stats);
    } catch (err: any) {
      setError(err?.message || 'Failed to load centralized management data.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  useEffect(() => {
    if (lastSyncEvent) {
      void loadAdminData();
    }
  }, [lastSyncEvent, loadAdminData]);

  const handleRoleChange = async (targetUser: DbUser, nextRole: 'admin' | 'member') => {
    try {
      setError(null);
      await apiFetch(`/api/admin/users/${targetUser.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      await loadAdminData();
    } catch (err: any) {
      setError(err?.message || 'Unable to update role.');
    }
  };

  if (loading) {
    return (
      <div className="h-96 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Centralized Database Metrics */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: 'Accounts', val: stats.users },
            { label: 'Gemini Threads', val: stats.geminiThreads ?? 0 },
            { label: 'Drive & Picker', val: stats.workspaceRecords },
            { label: 'Calendar & Meet', val: stats.calendarEvents + stats.meetSessions },
            { label: 'Gmail & Chat', val: stats.mailMessages + stats.chatMessages },
            { label: 'Classroom & Contacts', val: (stats.classroomCourses ?? 0) + (stats.contacts ?? 0) },
            { label: 'Tasks, Keep & Maps', val: stats.tasks + stats.notes + stats.mapLocations },
          ].map((item) => (
            <div
              key={item.label}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
            >
              <div className="text-xs text-slate-500 dark:text-slate-400">{item.label}</div>
              <div className="font-mono text-2xl font-semibold tabular-nums mt-1">{item.val}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Accounts Directory */}
        <section className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-sm font-semibold">
                {isAdmin ? 'Centralized User Accounts' : 'Your Account Profile'}
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-mono">
              {onlineUsers.length} active session(s)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Account</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Synced Services</th>
                  <th className="px-4 py-3 font-medium text-right">Last Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {usersList.map((u) => {
                  const isOnline = onlineUsers.some((o) => o.uid === u.uid);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {u.displayName || u.email}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {u.email} · {isOnline ? 'Connected now' : 'Offline'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin && u.id !== dbUser?.id ? (
                          <select
                            value={u.role}
                            onChange={(e) =>
                              void handleRoleChange(u, e.target.value as 'admin' | 'member')
                            }
                            className="h-7 px-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                          >
                            <option value="admin">admin</option>
                            <option value="member">member</option>
                          </select>
                        ) : (
                          <span className="capitalize font-medium">{u.role}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {u.connectedServices.length > 0
                          ? u.connectedServices.join(', ')
                          : 'SQL Hub'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-500">
                        {u.lastSyncedAt
                          ? new Date(u.lastSyncedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'Never'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Live Audit & Sync Log */}
        <section className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-sm font-semibold">Centralized Audit Trail</h2>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 font-mono">
              <Users className="w-3.5 h-3.5" /> {logs.length}
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[420px] overflow-y-auto">
            {logs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Activity logs will appear here as you create, update, and sync records.
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="px-4 py-3 text-xs space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {log.action}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {new Date(log.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 truncate">
                    {log.service} · {log.actorEmail} {log.detail ? `· ${log.detail}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
