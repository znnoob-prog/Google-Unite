import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import {
  CalendarEventRecord,
  ClassroomCourseRecord,
  ContactRecord,
  GeminiThreadRecord,
  MailMessageRecord,
  MapLocationRecord,
  NavSection,
  NoteRecord,
  TaskRecord,
  WorkspaceRecord,
} from '../types.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (section: NavSection) => void;
}

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  section: NavSection;
}

export const GlobalSearchModal: React.FC<Props> = ({ open, onClose, onNavigate }) => {
  const { apiFetch } = useAuth();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      apiFetch<{ threads: GeminiThreadRecord[] }>('/api/gemini/threads').catch(() => ({ threads: [] })),
      apiFetch<{ records: WorkspaceRecord[] }>('/api/records').catch(() => ({ records: [] })),
      apiFetch<{ events: CalendarEventRecord[] }>('/api/calendar').catch(() => ({ events: [] })),
      apiFetch<{ messages: MailMessageRecord[] }>('/api/mail').catch(() => ({ messages: [] })),
      apiFetch<{ tasks: TaskRecord[] }>('/api/tasks').catch(() => ({ tasks: [] })),
      apiFetch<{ notes: NoteRecord[] }>('/api/notes').catch(() => ({ notes: [] })),
      apiFetch<{ locations: MapLocationRecord[] }>('/api/maps/locations').catch(() => ({ locations: [] })),
      apiFetch<{ courses: ClassroomCourseRecord[] }>('/api/classroom/courses').catch(() => ({ courses: [] })),
      apiFetch<{ contacts: ContactRecord[] }>('/api/contacts').catch(() => ({ contacts: [] })),
    ])
      .then(([gem, rec, cal, mail, tsk, nts, loc, cls, cnt]) => {
        const merged: SearchItem[] = [
          ...gem.threads.map((t) => ({
            id: `gem-${t.id}`,
            title: t.title,
            subtitle: `Gemini · ${t.model}`,
            section: 'gemini' as NavSection,
          })),
          ...rec.records.map((r) => ({
            id: `rec-${r.id}`,
            title: r.title,
            subtitle: `${r.service} · ${r.summary || 'Workspace file'}`,
            section: 'drive' as NavSection,
          })),
          ...cal.events.map((e) => ({
            id: `cal-${e.id}`,
            title: e.title,
            subtitle: `Calendar · ${new Date(e.startTime).toLocaleDateString()}`,
            section: 'communications' as NavSection,
          })),
          ...mail.messages.map((m) => ({
            id: `mail-${m.id}`,
            title: m.subject,
            subtitle: `Gmail · ${m.fromEmail}`,
            section: 'communications' as NavSection,
          })),
          ...tsk.tasks.map((t) => ({
            id: `task-${t.id}`,
            title: t.title,
            subtitle: `Tasks · ${t.status}`,
            section: 'tasks_keep' as NavSection,
          })),
          ...nts.notes.map((n) => ({
            id: `note-${n.id}`,
            title: n.title || 'Untitled Note',
            subtitle: `Keep · ${n.content.slice(0, 60)}`,
            section: 'tasks_keep' as NavSection,
          })),
          ...cls.courses.map((c) => ({
            id: `cls-${c.id}`,
            title: c.name,
            subtitle: `Classroom · ${c.section || c.courseState}`,
            section: 'classroom_contacts' as NavSection,
          })),
          ...cnt.contacts.map((c) => ({
            id: `cnt-${c.id}`,
            title: c.displayName,
            subtitle: `Contacts · ${c.email || c.organization || c.phone}`,
            section: 'classroom_contacts' as NavSection,
          })),
          ...loc.locations.map((l) => ({
            id: `loc-${l.id}`,
            title: l.name,
            subtitle: `Maps · ${l.address}`,
            section: 'maps' as NavSection,
          })),
        ];
        setItems(merged);
      })
      .finally(() => setLoading(false));
  }, [open, apiFetch]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (i) => i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q)
      )
    : items.slice(0, 12);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-slate-950/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-12 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across Drive, Docs, Sheets, Gmail, Calendar, Tasks, Keep, and Maps..."
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-600"
            aria-label="Close search"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500">Searching SQL records...</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No matching records found in Cloud SQL.
            </div>
          ) : (
            filtered.slice(0, 20).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.section);
                  onClose();
                }}
                className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {item.title}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {item.subtitle}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
