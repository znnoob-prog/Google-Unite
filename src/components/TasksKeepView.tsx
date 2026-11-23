import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Pin,
  Plus,
  RefreshCw,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { getCachedEnterpriseKeepToken } from '../lib/firebase.ts';
import {
  createGoogleTask,
  createKeepNote,
  fetchGoogleTasks,
  fetchKeepNotes,
  updateGoogleTaskStatus,
} from '../lib/workspaceApi.ts';
import { ChecklistItem, NoteRecord, PendingConfirmation, TaskRecord } from '../types.ts';

interface Props {
  onRequestConfirm: (conf: PendingConfirmation) => void;
}

export const TasksKeepView: React.FC<Props> = ({ onRequestConfirm }) => {
  const { apiFetch, accessToken, signIn, lastSyncEvent } = useAuth();
  const [tasksList, setTasksList] = useState<TaskRecord[]>([]);
  const [notesList, setNotesList] = useState<NoteRecord[]>([]);
  const [syncingKeep, setSyncingKeep] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Task creation
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskPriority, setTaskPriority] = useState<'high' | 'medium' | 'low'>('medium');

  // Note creation
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteChecklistInput, setNoteChecklistInput] = useState('');
  const [noteShared, setNoteShared] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [tRes, nRes] = await Promise.all([
        apiFetch<{ tasks: TaskRecord[] }>('/api/tasks'),
        apiFetch<{ notes: NoteRecord[] }>('/api/notes'),
      ]);
      setTasksList(tRes.tasks);
      setNotesList(nRes.notes);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to load tasks and notes.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (lastSyncEvent && ['tasks:updated', 'notes:updated', 'sync:completed'].includes(lastSyncEvent.type)) {
      void loadAll();
    }
  }, [lastSyncEvent, loadAll]);

  const handleSyncTasks = async () => {
    if (!accessToken) {
      setStatusMsg('Connect Google Workspace in the sidebar to sync Google Tasks.');
      return;
    }
    setSyncing(true);
    setStatusMsg(null);
    try {
      const remoteTasks = await fetchGoogleTasks(accessToken);
      if (remoteTasks.length > 0) {
        await apiFetch('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ tasks: remoteTasks }),
        });
      }
      await loadAll();
      setStatusMsg(`Synchronized ${remoteTasks.length} Google Tasks to Cloud SQL.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Tasks sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    const title = taskTitle.trim();

    onRequestConfirm({
      serviceLabel: 'Google Tasks',
      title: `Create Task "${title}"?`,
      description: accessToken
        ? 'Add this task to your Google Tasks list and persist it in Cloud SQL?'
        : 'Save this task in Cloud SQL?',
      confirmLabel: 'Add Task',
      onConfirm: async () => {
        let externalId = `local-task-${Date.now()}`;
        if (accessToken) {
          const created = await createGoogleTask(accessToken, '@default', title, '', taskDue);
          externalId = created.id;
        }
        await apiFetch('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({
            externalId,
            title,
            dueDate: taskDue,
            priority: taskPriority,
            status: 'needsAction',
          }),
        });
        setTaskTitle('');
        setTaskDue('');
        await loadAll();
      },
    });
  };

  const handleToggleTask = async (task: TaskRecord) => {
    const nextStatus = task.status === 'completed' ? 'needsAction' : 'completed';
    if (accessToken && !task.externalId.startsWith('local-')) {
      onRequestConfirm({
        serviceLabel: 'Google Tasks',
        title: `Mark "${task.title}" as ${nextStatus === 'completed' ? 'Completed' : 'Active'}?`,
        description: 'Update this task status in Google Tasks and Cloud SQL?',
        confirmLabel: 'Update Task',
        onConfirm: async () => {
          await updateGoogleTaskStatus(accessToken, task.listId, task.externalId, nextStatus);
          await apiFetch(`/api/tasks/${task.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: nextStatus }),
          });
          await loadAll();
        },
      });
    } else {
      await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadAll();
    }
  };

  const handleDeleteTask = (task: TaskRecord) => {
    onRequestConfirm({
      serviceLabel: 'Google Tasks',
      title: `Delete "${task.title}"?`,
      description: 'Remove this task from your centralized SQL task list?',
      confirmLabel: 'Delete Task',
      isDestructive: true,
      onConfirm: async () => {
        await apiFetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
        await loadAll();
      },
    });
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const checklist: ChecklistItem[] = noteChecklistInput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text, idx) => ({ id: `${Date.now()}-${idx}`, text, checked: false }));

    if (!noteTitle.trim() && !noteContent.trim() && checklist.length === 0) return;

    await apiFetch('/api/notes', {
      method: 'POST',
      body: JSON.stringify({
        title: noteTitle.trim(),
        content: noteContent.trim(),
        checklist,
        isShared: noteShared,
      }),
    });
    setNoteTitle('');
    setNoteContent('');
    setNoteChecklistInput('');
    await loadAll();
  };

  const handleToggleChecklistItem = async (note: NoteRecord, itemId: string) => {
    const updatedChecklist = note.checklist.map((c) =>
      c.id === itemId ? { ...c, checked: !c.checked } : c
    );
    await apiFetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ checklist: updatedChecklist }),
    });
    await loadAll();
  };

  const handleTogglePin = async (note: NoteRecord) => {
    await apiFetch(`/api/notes/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isPinned: !note.isPinned }),
    });
    await loadAll();
  };

  const handleDeleteNote = (note: NoteRecord) => {
    onRequestConfirm({
      serviceLabel: 'Google Keep',
      title: `Delete "${note.title || 'Untitled Note'}"?`,
      description: 'Remove this Keep note from Cloud SQL?',
      confirmLabel: 'Delete Note',
      isDestructive: true,
      onConfirm: async () => {
        await apiFetch(`/api/notes/${note.id}`, { method: 'DELETE' });
        await loadAll();
      },
    });
  };

  const handleSyncKeepApi = async () => {
    let keepToken = getCachedEnterpriseKeepToken();
    if (!keepToken) {
      try {
        await signIn(true, false, true);
        keepToken = getCachedEnterpriseKeepToken();
      } catch (err: any) {
        setStatusMsg(
          err?.message ||
            'Google Keep API requires a Workspace Enterprise account with domain-wide delegation. Your PostgreSQL Keep Hub remains active below.'
        );
        return;
      }
    }
    if (!keepToken) return;
    setSyncingKeep(true);
    setStatusMsg(null);
    try {
      const remoteNotes = await fetchKeepNotes(keepToken);
      if (remoteNotes.length > 0) {
        await apiFetch('/api/notes', {
          method: 'POST',
          body: JSON.stringify({ notes: remoteNotes }),
        });
      }
      await loadAll();
      setStatusMsg(`Synchronized ${remoteNotes.length} Google Keep note(s) to Cloud SQL.`);
    } catch (err: any) {
      setStatusMsg(
        `${err?.message || 'Keep API unavailable'} — Note: Google Keep REST API is restricted to Workspace Enterprise domains. Local SQL Keep Hub works for all accounts.`
      );
    } finally {
      setSyncingKeep(false);
    }
  };

  const handlePushToKeepApi = async (note: NoteRecord) => {
    const keepToken = getCachedEnterpriseKeepToken();
    if (!keepToken) {
      setStatusMsg('Use "Sync Keep API (Enterprise)" first to authenticate Google Keep scopes.');
      return;
    }
    onRequestConfirm({
      serviceLabel: 'Google Keep',
      title: `Push "${note.title || 'Untitled Note'}" to Google Keep?`,
      description: 'Create a copy of this note in your Google Keep account?',
      confirmLabel: 'Push to Keep',
      onConfirm: async () => {
        await createKeepNote(keepToken, note.title || 'Note', note.content || '');
        setStatusMsg('Note created in Google Keep API.');
      },
    });
  };

  return (
    <div className="space-y-5">
      {statusMsg && (
        <div className="px-4 py-2.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-xs text-blue-800 dark:text-blue-200">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Google Tasks Panel */}
        <section className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-semibold">Google Tasks</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Synchronized with Tasks API &amp; Cloud SQL
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleSyncTasks()}
              disabled={syncing}
              className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Sync Tasks
            </button>
          </div>

          <form onSubmit={handleCreateTask} className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
            <input
              type="text"
              required
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="New task title..."
              className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <input
                type="date"
                value={taskDue}
                onChange={(e) => setTaskDue(e.target.value)}
                className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
              />
              <select
                value={taskPriority}
                onChange={(e) => setTaskPriority(e.target.value as typeof taskPriority)}
                className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              >
                <option value="high">High priority</option>
                <option value="medium">Medium priority</option>
                <option value="low">Low priority</option>
              </select>
              <button
                type="submit"
                className="h-9 px-3.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium inline-flex items-center gap-1.5 ml-auto"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
          </form>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1 max-h-[520px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-xs text-slate-500">Loading tasks...</div>
            ) : tasksList.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No tasks yet. Add one above or sync your Google Tasks.
              </div>
            ) : (
              tasksList.map((task) => {
                const done = task.status === 'completed';
                return (
                  <div key={task.id} className="px-4 py-3 flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => void handleToggleTask(task)}
                      className="mt-0.5 text-slate-400 hover:text-blue-600 shrink-0"
                      aria-label={`Toggle ${task.title}`}
                    >
                      {done ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Circle className="w-4 h-4" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-sm ${
                          done
                            ? 'line-through text-slate-400'
                            : 'text-slate-900 dark:text-slate-100 font-medium'
                        }`}
                      >
                        {task.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <span className="capitalize">{task.priority}</span>
                        {task.dueDate && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{task.dueDate}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteTask(task)}
                      className="p-1 text-slate-400 hover:text-red-600 shrink-0"
                      aria-label={`Delete ${task.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Google Keep Hub */}
        <section className="lg:col-span-7 space-y-4">
          <form
            onSubmit={(e) => void handleCreateNote(e)}
            className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-amber-600" />
                <h2 className="font-display text-sm font-semibold">Google Keep Hub</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Real-time SQL notes &amp; checklists
                </span>
                <button
                  type="button"
                  onClick={() => void handleSyncKeepApi()}
                  disabled={syncingKeep}
                  className="h-7 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-medium inline-flex items-center gap-1 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
                >
                  <RefreshCw className={`w-3 h-3 ${syncingKeep ? 'animate-spin' : ''}`} />
                  Sync Keep API (Enterprise)
                </button>
              </div>
            </div>

            <input
              type="text"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="Note title..."
              className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-medium"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <textarea
                rows={3}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Write a quick note..."
                className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <textarea
                rows={3}
                value={noteChecklistInput}
                onChange={(e) => setNoteChecklistInput(e.target.value)}
                placeholder="Checklist items (one per line)..."
                className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={noteShared}
                  onChange={(e) => setNoteShared(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Share with all Google Unite accounts
              </label>
              <button
                type="submit"
                className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
              >
                Save Note
              </button>
            </div>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {notesList.length === 0 ? (
              <div className="sm:col-span-2 p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-sm text-slate-500">
                No Keep notes yet. Create a note or checklist above to sync across your devices.
              </div>
            ) : (
              notesList.map((note) => (
                <div
                  key={note.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {note.title || 'Untitled Note'}
                      </h3>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleTogglePin(note)}
                          className={`p-1 rounded ${
                            note.isPinned ? 'text-blue-600' : 'text-slate-400 hover:text-slate-700'
                          }`}
                          aria-label="Pin note"
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteNote(note)}
                          className="p-1 rounded text-slate-400 hover:text-red-600"
                          aria-label="Delete note"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {note.content && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {note.content}
                      </p>
                    )}
                    {note.checklist.length > 0 && (
                      <ul className="space-y-1.5 pt-1">
                        {note.checklist.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => void handleToggleChecklistItem(note, item.id)}
                              className="flex items-center gap-2 text-xs text-left w-full"
                            >
                              {item.checked ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              ) : (
                                <Circle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              )}
                              <span
                                className={
                                  item.checked
                                    ? 'line-through text-slate-400'
                                    : 'text-slate-700 dark:text-slate-200'
                                }
                              >
                                {item.text}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span>{note.isShared ? 'Shared' : 'Private'}</span>
                    <div className="flex items-center gap-2">
                      {getCachedEnterpriseKeepToken() && (
                        <button
                          type="button"
                          onClick={() => void handlePushToKeepApi(note)}
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Push to Keep
                        </button>
                      )}
                      <span className="font-mono">{new Date(note.updatedAt).toLocaleDateString()}</span>
                    </div>
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
