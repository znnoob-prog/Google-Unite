import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckSquare,
  Database,
  Plus,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import {
  GeminiActionPlan,
  GeminiMessageRecord,
  GeminiThreadRecord,
} from '../types.ts';

const STARTER_PROMPTS = [
  'Brief me on my upcoming Calendar events, unread Gmail, and active Tasks.',
  'Summarize my recent Drive, Docs, and Sheets activity from Cloud SQL.',
  'Turn my Keep notes and recent emails into a prioritized action plan.',
  'Suggest a logical itinerary connecting my saved Maps locations.',
];

export const GeminiWorkspaceView: React.FC = () => {
  const { apiFetch, firebaseUser, lastSyncEvent } = useAuth();
  const [threads, setThreads] = useState<GeminiThreadRecord[]>([]);
  const [activeThread, setActiveThread] = useState<GeminiThreadRecord | null>(null);
  const [messages, setMessages] = useState<GeminiMessageRecord[]>([]);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<'gemini-4-hydrogen' | 'gemini-3.1-flash-lite'>(
    'gemini-4-hydrogen'
  );
  const [groundWithWorkspace, setGroundWithWorkspace] = useState(true);

  const [loadingThreads, setLoadingThreads] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [streamingReply, setStreamingReply] = useState('');
  const [streamingRefs, setStreamingRefs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  // Action plan extractor state
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [extractedPlan, setExtractedPlan] = useState<GeminiActionPlan | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const res = await apiFetch<{ threads: GeminiThreadRecord[] }>('/api/gemini/threads');
      setThreads(res.threads);
      setActiveThread((prev) => {
        if (prev && res.threads.some((t) => t.id === prev.id)) {
          return res.threads.find((t) => t.id === prev.id) ?? prev;
        }
        return res.threads[0] ?? null;
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load Gemini conversations.');
    } finally {
      setLoadingThreads(false);
    }
  }, [apiFetch]);

  const loadMessages = useCallback(
    async (threadId: number) => {
      try {
        const res = await apiFetch<{ messages: GeminiMessageRecord[] }>(
          `/api/gemini/threads/${threadId}/messages`
        );
        setMessages(res.messages);
      } catch (err: any) {
        setErrorMsg(err?.message || 'Failed to load conversation messages.');
      }
    },
    [apiFetch]
  );

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (activeThread) {
      setModel(activeThread.model || 'gemini-4-hydrogen');
      setGroundWithWorkspace(activeThread.groundWithWorkspace);
      void loadMessages(activeThread.id);
    } else {
      setMessages([]);
    }
  }, [activeThread, loadMessages]);

  useEffect(() => {
    if (lastSyncEvent?.type === 'gemini:updated' && !streaming) {
      void loadThreads();
      if (activeThread) {
        void loadMessages(activeThread.id);
      }
    }
  }, [lastSyncEvent, streaming, activeThread, loadThreads, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingReply]);

  const handleCreateThread = async (): Promise<GeminiThreadRecord | null> => {
    setErrorMsg(null);
    setExtractedPlan(null);
    const res = await apiFetch<{ thread: GeminiThreadRecord }>('/api/gemini/threads', {
      method: 'POST',
      body: JSON.stringify({
        title: 'New Gemini Conversation',
        model,
        groundWithWorkspace,
      }),
    });
    await loadThreads();
    setActiveThread(res.thread);
    setMessages([]);
    return res.thread;
  };

  const handleDeleteThread = async (threadId: number) => {
    setErrorMsg(null);
    await apiFetch(`/api/gemini/threads/${threadId}`, { method: 'DELETE' });
    if (activeThread?.id === threadId) {
      setActiveThread(null);
      setMessages([]);
      setExtractedPlan(null);
    }
    await loadThreads();
  };

  const sendPrompt = async (textInput: string) => {
    const trimmed = textInput.trim();
    if (!trimmed || !firebaseUser || streaming) return;

    setErrorMsg(null);
    setActionBanner(null);
    setExtractedPlan(null);
    setPrompt('');
    setStreaming(true);
    setStreamingReply('');
    setStreamingRefs([]);

    try {
      let targetThread = activeThread;
      if (!targetThread) {
        targetThread = await handleCreateThread();
      }
      if (!targetThread) {
        throw new Error('Unable to initialize conversation.');
      }

      const idToken = await firebaseUser.getIdToken();
      const response = await fetch(`/api/gemini/threads/${targetThread.id}/messages/stream`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: trimmed,
          model,
          groundWithWorkspace,
        }),
      });

      if (!response.ok || !response.body) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamHadError = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const block of lines) {
          const dataLine = block
            .split('\n')
            .find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const evt = JSON.parse(dataLine.slice(6));
            if (evt.type === 'user_saved' && evt.message) {
              setMessages((prev) => [...prev, evt.message as GeminiMessageRecord]);
              if (Array.isArray(evt.contextRefs)) {
                setStreamingRefs(evt.contextRefs);
              }
            } else if (evt.type === 'delta' && typeof evt.text === 'string') {
              setStreamingReply((prev) => prev + evt.text);
            } else if (evt.type === 'done' && evt.message) {
              setMessages((prev) => [...prev, evt.message as GeminiMessageRecord]);
              setStreamingReply('');
            } else if (evt.type === 'error') {
              streamHadError = true;
              setErrorMsg(evt.error || 'Gemini could not complete this request.');
            }
          } catch {
            // ignore partial SSE JSON
          }
        }
      }

      if (!streamHadError) {
        await loadThreads();
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to communicate with Google Gemini.');
    } finally {
      setStreaming(false);
      setStreamingReply('');
      setStreamingRefs([]);
    }
  };

  const handleExtractActions = async (msg: GeminiMessageRecord) => {
    setExtractingId(msg.id);
    setErrorMsg(null);
    setActionBanner(null);
    try {
      const res = await apiFetch<{ plan: GeminiActionPlan }>('/api/gemini/extract-actions', {
        method: 'POST',
        body: JSON.stringify({
          sourceText: msg.content,
          groundWithWorkspace,
        }),
      });
      setExtractedPlan(res.plan);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to extract structured actions.');
    } finally {
      setExtractingId(null);
    }
  };

  const handleSaveExtractedTasks = async () => {
    if (!extractedPlan || extractedPlan.tasks.length === 0) return;
    setSavingPlan(true);
    try {
      await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          tasks: extractedPlan.tasks.map((t, idx) => ({
            externalId: `gemini-task-${Date.now()}-${idx}`,
            title: t.title,
            notes: t.notes,
            priority: t.priority,
            status: 'needsAction',
          })),
        }),
      });
      setActionBanner(`Saved ${extractedPlan.tasks.length} task(s) from Gemini into Cloud SQL Tasks.`);
      setExtractedPlan(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save tasks.');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleSaveExtractedKeepNote = async () => {
    if (!extractedPlan) return;
    setSavingPlan(true);
    try {
      await apiFetch('/api/notes', {
        method: 'POST',
        body: JSON.stringify({
          title: extractedPlan.noteTitle,
          content: extractedPlan.noteSummary,
          checklist: extractedPlan.tasks.map((t, idx) => ({
            id: `gem-${Date.now()}-${idx}`,
            text: `[${t.priority.toUpperCase()}] ${t.title}`,
            checked: false,
          })),
          isPinned: true,
          isShared: false,
        }),
      });
      setActionBanner(`Saved "${extractedPlan.noteTitle}" as a pinned Keep checklist note in Cloud SQL.`);
      setExtractedPlan(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to save Keep note.');
    } finally {
      setSavingPlan(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Controls Bar */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="font-display text-sm font-semibold">Google Gemini</span>
          </div>

          <select
            value={model}
            onChange={(e) => setModel(e.target.value as typeof model)}
            disabled={streaming}
            aria-label="Gemini model"
            className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium"
          >
            <option value="gemini-4-hydrogen">Gemini 4 Hydrogen (Balanced)</option>
            <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Fast)</option>
          </select>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={groundWithWorkspace}
              onChange={(e) => setGroundWithWorkspace(e.target.checked)}
              disabled={streaming}
              className="rounded border-slate-300"
            />
            <Database className="w-3.5 h-3.5 text-slate-500" />
            <span>Ground with Cloud SQL Workspace</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          {/* Mobile quick thread switcher */}
          {threads.length > 0 && (
            <select
              value={activeThread?.id ?? ''}
              onChange={(e) => {
                const found = threads.find((t) => t.id === Number(e.target.value));
                if (found) setActiveThread(found);
              }}
              className="lg:hidden h-9 max-w-[180px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              aria-label="Select conversation"
            >
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void handleCreateThread()}
            disabled={streaming}
            className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
          >
            <Plus className="w-3.5 h-3.5" />
            New Conversation
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="px-4 py-2.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {actionBanner && (
        <div className="px-4 py-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-200">
          {actionBanner}
        </div>
      )}

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden min-h-[560px]">
        {/* Desktop Thread List */}
        <div className="hidden lg:flex lg:col-span-3 border-r border-slate-200 dark:border-slate-800 flex-col">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-display text-xs font-semibold uppercase tracking-wide text-slate-500">
              Saved Threads (SQL)
            </h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {threads.length}
            </span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto flex-1 max-h-[580px]">
            {loadingThreads ? (
              <div className="p-4 text-xs text-slate-500">Loading threads...</div>
            ) : threads.length === 0 ? (
              <div className="p-5 text-xs text-slate-500 leading-relaxed">
                Start a prompt on the right to create your first synchronized Gemini conversation.
              </div>
            ) : (
              threads.map((t) => (
                <div
                  key={t.id}
                  className={`px-3.5 py-3 flex items-center justify-between gap-2 transition-colors ${
                    activeThread?.id === t.id
                      ? 'bg-blue-50/80 dark:bg-blue-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveThread(t)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                      {t.title}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                      {t.model === 'gemini-3.1-flash-lite' ? 'Flash Lite' : '4 Hydrogen'} ·{' '}
                      {new Date(t.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteThread(t.id)}
                    className="p-1 text-slate-400 hover:text-red-600 shrink-0"
                    aria-label={`Delete ${t.title}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Conversation & Streaming Output */}
        <div className="lg:col-span-9 flex flex-col min-h-[560px] max-h-[680px]">
          <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-4">
            {messages.length === 0 && !streaming ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto py-8 space-y-5">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-blue-600 dark:text-blue-400">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                    Ask Google Gemini across your Workspace
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Synthesize synced Gmail, Calendar events, Drive/Docs/Sheets files, Tasks, Keep notes,
                    and saved Map locations directly from Cloud SQL, then export action plans back to Tasks or Keep.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
                  {STARTER_PROMPTS.map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => void sendPrompt(sample)}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 hover:border-blue-400 dark:hover:border-blue-600 text-xs text-slate-700 dark:text-slate-300 leading-relaxed transition-colors"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-2">
                        <span>{isUser ? 'You' : 'Google Gemini'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">
                          {new Date(msg.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <div
                        className={`max-w-[90%] sm:max-w-[82%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                          isUser
                            ? 'bg-blue-600 text-white'
                            : 'border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {msg.content}
                      </div>

                      {!isUser && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                          {msg.contextRefs.length > 0 && (
                            <span className="font-mono">
                              Grounded: {msg.contextRefs.join(' · ')}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleExtractActions(msg)}
                            disabled={extractingId === msg.id}
                            className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-1"
                          >
                            <CheckSquare className="w-3 h-3" />
                            {extractingId === msg.id
                              ? 'Extracting...'
                              : 'Extract Tasks & Keep Note'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {streaming && (
                  <div className="flex flex-col items-start">
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-2">
                      <span>Google Gemini</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">Streaming</span>
                    </div>
                    <div className="max-w-[90%] sm:max-w-[82%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
                      {streamingReply || 'Thinking across your workspace...'}
                    </div>
                    {streamingRefs.length > 0 && (
                      <div className="mt-1 text-[11px] font-mono text-slate-500">
                        Grounded: {streamingRefs.join(' · ')}
                      </div>
                    )}
                  </div>
                )}

                {extractedPlan && (
                  <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          Structured Action Plan: {extractedPlan.noteTitle}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                          {extractedPlan.noteSummary}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExtractedPlan(null)}
                        className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        Dismiss
                      </button>
                    </div>

                    <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
                      {extractedPlan.tasks.map((t, idx) => (
                        <li key={idx} className="px-3 py-2 flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {t.title}
                            </div>
                            {t.notes && (
                              <div className="text-slate-500 dark:text-slate-400">{t.notes}</div>
                            )}
                          </div>
                          <span className="font-mono text-[11px] uppercase text-slate-500 shrink-0">
                            {t.priority}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveExtractedTasks()}
                        disabled={savingPlan || extractedPlan.tasks.length === 0}
                        className="h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        Save to Tasks (SQL)
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveExtractedKeepNote()}
                        disabled={savingPlan}
                        className="h-8 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                      >
                        <StickyNote className="w-3.5 h-3.5" />
                        Save as Keep Checklist
                      </button>
                    </div>
                  </div>
                )}

                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Prompt Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendPrompt(prompt);
            }}
            className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-white dark:bg-slate-900"
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask Google Gemini to summarize, plan, draft, or analyze your Workspace..."
              disabled={streaming}
              className="flex-1 h-10 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={streaming || !prompt.trim()}
              className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {streaming ? 'Streaming...' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
