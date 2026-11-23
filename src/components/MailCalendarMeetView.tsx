import React, { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  ExternalLink,
  Mail,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Video,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import {
  createCalendarEvent,
  createGoogleMeetSpace,
  deleteCalendarEvent,
  fetchCalendarEvents,
  fetchGmailMessages,
  sendGmailMessage,
  trashGmailMessage,
} from '../lib/workspaceApi.ts';
import {
  CalendarEventRecord,
  MailMessageRecord,
  MeetSessionRecord,
  PendingConfirmation,
} from '../types.ts';

interface Props {
  onRequestConfirm: (conf: PendingConfirmation) => void;
}

export const MailCalendarMeetView: React.FC<Props> = ({ onRequestConfirm }) => {
  const { apiFetch, accessToken, lastSyncEvent } = useAuth();
  const [activeTab, setActiveTab] = useState<'mail' | 'calendar' | 'meet'>('mail');

  const [mails, setMails] = useState<MailMessageRecord[]>([]);
  const [selectedMail, setSelectedMail] = useState<MailMessageRecord | null>(null);
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [meets, setMeets] = useState<MeetSessionRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Compose mail state
  const [showCompose, setShowCompose] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');

  // New calendar event state
  const [eventTitle, setEventTitle] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventStart, setEventStart] = useState(() => new Date(Date.now() + 3600000).toISOString().slice(0, 16));
  const [eventEnd, setEventEnd] = useState(() => new Date(Date.now() + 7200000).toISOString().slice(0, 16));
  const [includeMeet, setIncludeMeet] = useState(true);

  // New Meet title
  const [meetTitle, setMeetTitle] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const [mailRes, calRes, meetRes] = await Promise.all([
        apiFetch<{ messages: MailMessageRecord[] }>('/api/mail'),
        apiFetch<{ events: CalendarEventRecord[] }>('/api/calendar'),
        apiFetch<{ sessions: MeetSessionRecord[] }>('/api/meet'),
      ]);
      setMails(mailRes.messages);
      setSelectedMail((prev) => prev ?? (mailRes.messages[0] || null));
      setEvents(calRes.events);
      setMeets(meetRes.sessions);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to load communications.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (
      lastSyncEvent &&
      ['mail:updated', 'calendar:updated', 'meet:updated', 'sync:completed'].includes(
        lastSyncEvent.type
      )
    ) {
      void loadAll();
    }
  }, [lastSyncEvent, loadAll]);

  const handleSyncGmailAndCalendar = async () => {
    if (!accessToken) {
      setStatusMsg('Connect Google Workspace in the sidebar to sync Gmail and Calendar.');
      return;
    }
    setSyncing(true);
    setStatusMsg(null);
    try {
      const [gmailList, calList] = await Promise.all([
        fetchGmailMessages(accessToken),
        fetchCalendarEvents(accessToken),
      ]);
      if (gmailList.length > 0) {
        await apiFetch('/api/mail', {
          method: 'POST',
          body: JSON.stringify({ messages: gmailList }),
        });
      }
      if (calList.length > 0) {
        await apiFetch('/api/calendar', {
          method: 'POST',
          body: JSON.stringify({
            events: calList.map((ev) => ({
              externalId: ev.id,
              title: ev.summary || 'Untitled Event',
              description: ev.description || '',
              location: ev.location || '',
              startTime: ev.start?.dateTime || ev.start?.date || new Date().toISOString(),
              endTime: ev.end?.dateTime || ev.end?.date || new Date().toISOString(),
              meetLink: ev.hangoutLink || '',
              status: ev.status || 'confirmed',
            })),
          }),
        });
      }
      await loadAll();
      setStatusMsg(`Synced ${gmailList.length} emails and ${calList.length} calendar events to Cloud SQL.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Sync encountered an issue.');
    } finally {
      setSyncing(false);
    }
  };

  const handleSendMailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mailTo.trim() || !mailSubject.trim()) return;
    onRequestConfirm({
      serviceLabel: 'Gmail',
      title: 'Send Email via Gmail?',
      description: `This will send an email to "${mailTo}" with subject "${mailSubject}" and log it in PostgreSQL.`,
      confirmLabel: 'Send Email',
      onConfirm: async () => {
        let extId = `local-sent-${Date.now()}`;
        if (accessToken) {
          const sent = await sendGmailMessage(accessToken, mailTo.trim(), mailSubject.trim(), mailBody);
          extId = sent.id;
        }
        await apiFetch('/api/mail', {
          method: 'POST',
          body: JSON.stringify({
            externalId: extId,
            fromEmail: 'me',
            toEmail: mailTo.trim(),
            subject: mailSubject.trim(),
            snippet: mailBody.slice(0, 120),
            body: mailBody,
            labels: ['SENT'],
            isUnread: false,
            receivedAt: new Date().toISOString(),
          }),
        });
        setShowCompose(false);
        setMailTo('');
        setMailSubject('');
        setMailBody('');
        await loadAll();
      },
    });
  };

  const handleDeleteMail = (mail: MailMessageRecord) => {
    onRequestConfirm({
      serviceLabel: 'Gmail',
      title: 'Move Email to Trash?',
      description: `Move "${mail.subject}" to Trash in Gmail and remove it from your SQL inbox?`,
      confirmLabel: 'Move to Trash',
      isDestructive: true,
      items: [`From: ${mail.fromEmail}`, `Subject: ${mail.subject}`],
      onConfirm: async () => {
        if (accessToken && !mail.externalId.startsWith('local-')) {
          await trashGmailMessage(accessToken, mail.externalId);
        }
        await apiFetch(`/api/mail/${mail.id}`, { method: 'DELETE' });
        if (selectedMail?.id === mail.id) setSelectedMail(null);
        await loadAll();
      },
    });
  };

  const handleToggleMailRead = async (mail: MailMessageRecord) => {
    await apiFetch(`/api/mail/${mail.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isUnread: !mail.isUnread }),
    });
    await loadAll();
  };

  const handleCreateEventSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventTitle.trim()) return;
    onRequestConfirm({
      serviceLabel: 'Google Calendar & Meet',
      title: 'Create Calendar Event?',
      description: `Schedule "${eventTitle}"${includeMeet ? ' with a live Google Meet space' : ''} and save to Cloud SQL?`,
      confirmLabel: 'Create Event',
      onConfirm: async () => {
        let meetUri = '';
        if (includeMeet && accessToken) {
          const space = await createGoogleMeetSpace(accessToken);
          meetUri = space.meetingUri;
          await apiFetch('/api/meet', {
            method: 'POST',
            body: JSON.stringify({
              title: eventTitle.trim(),
              meetingUri: space.meetingUri,
              meetingCode: space.meetingCode,
              spaceName: space.name,
              status: 'scheduled',
              scheduledFor: new Date(eventStart).toISOString(),
            }),
          });
        }
        let extId = `local-cal-${Date.now()}`;
        if (accessToken) {
          const created = await createCalendarEvent(accessToken, {
            summary: eventTitle.trim(),
            description: meetUri ? `Google Meet: ${meetUri}` : '',
            location: eventLocation.trim(),
            startIso: new Date(eventStart).toISOString(),
            endIso: new Date(eventEnd).toISOString(),
          });
          extId = created.id;
        }
        await apiFetch('/api/calendar', {
          method: 'POST',
          body: JSON.stringify({
            externalId: extId,
            title: eventTitle.trim(),
            location: eventLocation.trim(),
            startTime: new Date(eventStart).toISOString(),
            endTime: new Date(eventEnd).toISOString(),
            meetLink: meetUri,
          }),
        });
        setEventTitle('');
        setEventLocation('');
        await loadAll();
      },
    });
  };

  const handleDeleteEvent = (ev: CalendarEventRecord) => {
    onRequestConfirm({
      serviceLabel: 'Google Calendar',
      title: 'Delete Calendar Event?',
      description: `Permanently delete "${ev.title}" from Google Calendar and Cloud SQL?`,
      confirmLabel: 'Delete Event',
      isDestructive: true,
      items: [ev.title, new Date(ev.startTime).toLocaleString()],
      onConfirm: async () => {
        if (accessToken && !ev.externalId.startsWith('local-')) {
          await deleteCalendarEvent(accessToken, ev.externalId);
        }
        await apiFetch(`/api/calendar/${ev.id}`, { method: 'DELETE' });
        await loadAll();
      },
    });
  };

  const handleCreateMeet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) {
      setStatusMsg('Connect Google Workspace first to create live Google Meet rooms via Meet API.');
      return;
    }
    setSyncing(true);
    setStatusMsg(null);
    try {
      const space = await createGoogleMeetSpace(accessToken);
      await apiFetch('/api/meet', {
        method: 'POST',
        body: JSON.stringify({
          title: meetTitle.trim() || 'Instant Google Unite Meeting',
          meetingUri: space.meetingUri,
          meetingCode: space.meetingCode,
          spaceName: space.name,
          status: 'active',
        }),
      });
      setMeetTitle('');
      await loadAll();
      setStatusMsg(`Created live Meet space (${space.meetingCode}).`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Could not create Google Meet space.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation & Sync Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
          {[
            { id: 'mail' as const, label: `Gmail (${mails.length})`, icon: Mail },
            { id: 'calendar' as const, label: `Calendar (${events.length})`, icon: Calendar },
            { id: 'meet' as const, label: `Google Meet (${meets.length})`, icon: Video },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'mail' && (
            <button
              type="button"
              onClick={() => setShowCompose((v) => !v)}
              className="h-9 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Compose Email
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSyncGmailAndCalendar()}
            disabled={syncing}
            className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync Gmail &amp; Calendar
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="px-4 py-2.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-xs text-blue-800 dark:text-blue-200">
          {statusMsg}
        </div>
      )}

      {loading ? (
        <div className="h-96 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
      ) : activeTab === 'mail' ? (
        <div className="space-y-4">
          {showCompose && (
            <form
              onSubmit={handleSendMailSubmit}
              className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
            >
              <h3 className="font-display text-sm font-semibold">New Gmail Message</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="email"
                  required
                  value={mailTo}
                  onChange={(e) => setMailTo(e.target.value)}
                  placeholder="Recipient email"
                  className="h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                />
                <input
                  type="text"
                  required
                  value={mailSubject}
                  onChange={(e) => setMailSubject(e.target.value)}
                  placeholder="Subject"
                  className="h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                />
              </div>
              <textarea
                rows={4}
                value={mailBody}
                onChange={(e) => setMailBody(e.target.value)}
                placeholder="Write your message..."
                className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCompose(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  Review &amp; Send
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden min-h-[460px]">
            <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 max-h-[540px] overflow-y-auto">
              {mails.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No emails synced yet. Click &ldquo;Sync Gmail &amp; Calendar&rdquo; or compose a message.
                </div>
              ) : (
                mails.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMail(m)}
                    className={`w-full px-4 py-3.5 text-left transition-colors ${
                      selectedMail?.id === m.id
                        ? 'bg-blue-50/80 dark:bg-blue-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-xs truncate ${m.isUnread ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-600 dark:text-slate-300'}`}>
                        {m.fromEmail}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400 shrink-0 tabular-nums">
                        {new Date(m.receivedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className={`text-sm truncate mt-0.5 ${m.isUnread ? 'font-semibold' : ''}`}>
                      {m.subject}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {m.snippet}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="lg:col-span-7 p-6 flex flex-col">
              {selectedMail ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                    <div className="space-y-1 min-w-0">
                      <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {selectedMail.subject}
                      </h3>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        From: {selectedMail.fromEmail} · {new Date(selectedMail.receivedAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleToggleMailRead(selectedMail)}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Mark {selectedMail.isUnread ? 'Read' : 'Unread'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteMail(selectedMail)}
                        className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50"
                        aria-label="Delete message"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {selectedMail.body || selectedMail.snippet}
                  </div>
                </div>
              ) : (
                <div className="m-auto text-sm text-slate-500">Select an email to read</div>
              )}
            </div>
          </div>
        </div>
      ) : activeTab === 'calendar' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleCreateEventSubmit}
            className="lg:col-span-4 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 h-fit"
          >
            <h3 className="font-display text-sm font-semibold">Schedule Calendar Event</h3>
            <input
              type="text"
              required
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              placeholder="Event title"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
            />
            <input
              type="text"
              value={eventLocation}
              onChange={(e) => setEventLocation(e.target.value)}
              placeholder="Location or address"
              className="w-full h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
            />
            <div className="space-y-2">
              <label className="block text-xs text-slate-500">Start</label>
              <input
                type="datetime-local"
                value={eventStart}
                onChange={(e) => setEventStart(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
              />
              <label className="block text-xs text-slate-500">End</label>
              <input
                type="datetime-local"
                value={eventEnd}
                onChange={(e) => setEventEnd(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={includeMeet}
                onChange={(e) => setIncludeMeet(e.target.checked)}
                className="rounded border-slate-300"
              />
              Attach new Google Meet video space
            </label>
            <button
              type="submit"
              className="w-full h-10 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
            >
              Review &amp; Schedule Event
            </button>
          </form>

          <div className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {events.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No calendar events stored yet. Sync Google Calendar or create an event on the left.
              </div>
            ) : (
              events.map((ev) => (
                <div key={ev.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {ev.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {new Date(ev.startTime).toLocaleString()} — {new Date(ev.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {ev.location && (
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        Location: {ev.location}
                      </div>
                    )}
                    {ev.meetLink && ev.meetLink.startsWith('https://') && (
                      <a
                        href={ev.meetLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline pt-0.5"
                      >
                        <Video className="w-3.5 h-3.5" />
                        Join Google Meet
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteEvent(ev)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600"
                    aria-label={`Delete ${ev.title}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <form
            onSubmit={(e) => void handleCreateMeet(e)}
            className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center"
          >
            <input
              type="text"
              value={meetTitle}
              onChange={(e) => setMeetTitle(e.target.value)}
              placeholder="Meeting topic (e.g. Q4 Product Sync)"
              className="flex-1 h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
            />
            <button
              type="submit"
              disabled={syncing}
              className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-60"
            >
              <Video className="w-4 h-4" />
              Create Instant Meet Space
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {meets.length === 0 ? (
              <div className="md:col-span-2 lg:col-span-3 p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-sm text-slate-500">
                No Google Meet rooms created yet. Create an instant meeting space above.
              </div>
            ) : (
              meets.map((m) => (
                <div
                  key={m.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {m.title}
                    </div>
                    <div className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1">
                      Code: {m.meetingCode || 'N/A'} · {new Date(m.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {m.meetingUri.startsWith('https://') && (
                      <a
                        href={m.meetingUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Launch Meeting <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void apiFetch(`/api/meet/${m.id}`, { method: 'DELETE' }).then(loadAll)
                      }
                      className="p-1.5 rounded text-slate-400 hover:text-red-600"
                      aria-label="Remove session"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
