import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Hash, Plus, RefreshCw, Send, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { FIREBASE_PROJECT_ID, getCachedEnterpriseChatToken } from '../lib/firebase.ts';
import { fetchGoogleChatSpaces } from '../lib/workspaceApi.ts';
import { ChatMessageRecord, ChatSpaceRecord } from '../types.ts';

export const ChatHubView: React.FC = () => {
  const { apiFetch, signIn, onlineUsers, lastSyncEvent, wsConnected, dbUser } = useAuth();
  const [spaces, setSpaces] = useState<ChatSpaceRecord[]>([]);
  const [activeSpace, setActiveSpace] = useState<ChatSpaceRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [newSpaceName, setNewSpaceName] = useState('');
  const [showNewSpace, setShowNewSpace] = useState(false);
  const [chatApiNotice, setChatApiNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadSpaces = useCallback(async () => {
    try {
      const res = await apiFetch<{ spaces: ChatSpaceRecord[] }>('/api/chat/spaces');
      setSpaces(res.spaces);
      setActiveSpace((prev) => prev ?? (res.spaces[0] || null));
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const loadMessages = useCallback(async (spaceId: number) => {
    const res = await apiFetch<{ messages: ChatMessageRecord[] }>(
      `/api/chat/spaces/${spaceId}/messages`
    );
    setMessages(res.messages);
  }, [apiFetch]);

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  useEffect(() => {
    if (activeSpace) {
      void loadMessages(activeSpace.id);
    }
  }, [activeSpace, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    if (!lastSyncEvent) return;
    if (lastSyncEvent.type === 'chat:spaces_updated') {
      void loadSpaces();
    } else if (lastSyncEvent.type === 'chat:message_created' && activeSpace) {
      const payload = lastSyncEvent.payload as { spaceId?: number; message?: ChatMessageRecord };
      if (payload?.spaceId === activeSpace.id && payload.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === payload.message!.id) ? prev : [...prev, payload.message!]
        );
      }
    }
  }, [lastSyncEvent, activeSpace, loadSpaces]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSpace || !newMessage.trim()) return;
    const text = newMessage.trim();
    setNewMessage('');
    await apiFetch(`/api/chat/spaces/${activeSpace.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: text }),
    });
    await loadMessages(activeSpace.id);
  };

  const handleCreateSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpaceName.trim()) return;
    const res = await apiFetch<{ space: ChatSpaceRecord }>('/api/chat/spaces', {
      method: 'POST',
      body: JSON.stringify({ name: newSpaceName.trim() }),
    });
    setNewSpaceName('');
    setShowNewSpace(false);
    await loadSpaces();
    setActiveSpace(res.space);
  };

  const handleSyncGoogleChat = async () => {
    setChatApiNotice(null);
    let token = getCachedEnterpriseChatToken();
    if (!token) {
      await signIn(true, true);
      token = getCachedEnterpriseChatToken();
    }
    if (!token) {
      setChatApiNotice('Google Chat authorization was not granted.');
      return;
    }
    try {
      const remoteSpaces = await fetchGoogleChatSpaces(token);
      for (const s of remoteSpaces) {
        await apiFetch('/api/chat/spaces', {
          method: 'POST',
          body: JSON.stringify({
            name: s.displayName || s.name,
            slug: s.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase(),
            externalSpaceName: s.name,
            description: `Synced from Google Chat (${s.type || 'SPACE'})`,
          }),
        });
      }
      await loadSpaces();
      setChatApiNotice(`Synced ${remoteSpaces.length} Google Chat space(s) to Cloud SQL.`);
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('Chat app not found') || err?.status === 404) {
        setChatApiNotice(
          `Google Chat API requires a Business/Enterprise Workspace account and Chat app configuration in Google Cloud Console (project: ${FIREBASE_PROJECT_ID}). Your real-time SQL channels remain active below.`
        );
      } else {
        setChatApiNotice(msg || 'Unable to reach Google Chat API. SQL real-time channels remain active.');
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            <span className="font-mono tabular-nums">{onlineUsers.length}</span> active across devices
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{wsConnected ? 'WebSocket Live' : 'Connecting...'}</span>
        </div>

        <button
          type="button"
          onClick={() => void handleSyncGoogleChat()}
          className="h-9 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Sync Enterprise Google Chat
        </button>
      </div>

      {chatApiNotice && (
        <div className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
          <span>{chatApiNotice}</span>
          <a
            href={`https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=${FIREBASE_PROJECT_ID}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium inline-flex items-center gap-1 whitespace-nowrap"
          >
            Configure Chat App in Console <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden h-[560px]">
        {/* Spaces Sidebar */}
        <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Channels &amp; Spaces</h2>
            <button
              type="button"
              onClick={() => setShowNewSpace((v) => !v)}
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="New space"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {showNewSpace && (
            <form onSubmit={(e) => void handleCreateSpace(e)} className="p-3 border-b border-slate-200 dark:border-slate-800 flex gap-2">
              <input
                type="text"
                required
                value={newSpaceName}
                onChange={(e) => setNewSpaceName(e.target.value)}
                placeholder="Channel name..."
                className="flex-1 h-8 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <button
                type="submit"
                className="h-8 px-3 rounded-lg bg-blue-600 text-white text-xs font-medium"
              >
                Create
              </button>
            </form>
          )}

          <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto flex-1">
            {loading ? (
              <div className="p-4 text-xs text-slate-500">Loading spaces...</div>
            ) : (
              spaces.map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => setActiveSpace(sp)}
                  className={`w-full px-4 py-3 text-left flex items-center gap-2.5 transition-colors ${
                    activeSpace?.id === sp.id
                      ? 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <Hash className="w-4 h-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{sp.name}</div>
                    {sp.description && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {sp.description}
                      </div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Message Stream */}
        <div className="lg:col-span-8 flex flex-col min-h-0">
          <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold">
                {activeSpace ? activeSpace.name : 'Select a channel'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Persisted in PostgreSQL · Broadcast instantly via WebSockets
              </p>
            </div>
          </div>

          <div className="flex-1 p-4 space-y-3 overflow-y-auto">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">
                No messages in this space yet. Start the conversation below.
              </div>
            ) : (
              messages.map((m) => {
                const isMe = dbUser?.id === m.userId;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      {m.senderName} · <span className="font-mono">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div
                      className={`max-w-[80%] px-3.5 py-2.5 rounded-xl text-sm ${
                        isMe
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => void handleSendMessage(e)}
            className="p-3 border-t border-slate-200 dark:border-slate-800 flex gap-2"
          >
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={activeSpace ? `Message #${activeSpace.name}...` : 'Select a space...'}
              disabled={!activeSpace}
              className="flex-1 h-10 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
            />
            <button
              type="submit"
              disabled={!activeSpace || !newMessage.trim()}
              className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
