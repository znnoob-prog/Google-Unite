import React, { useCallback, useEffect, useState } from 'react';
import {
  ClipboardList,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  FolderSearch,
  Plus,
  Presentation,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import {
  deleteFirestorePickerBookmark,
  FirestorePickerBookmark,
  listFirestorePickerBookmarks,
  saveFirestorePickerBookmark,
} from '../lib/firebase.ts';
import { openGooglePicker } from '../lib/googlePicker.ts';
import {
  appendGoogleDocText,
  classifyDriveMime,
  createGoogleDoc,
  createGoogleForm,
  createGooglePresentation,
  createGoogleSheet,
  deleteDriveFile,
  fetchDriveFiles,
  fetchGoogleDoc,
  fetchGoogleForm,
  fetchGooglePresentation,
  fetchGoogleSheet,
  updateGoogleSheetValues,
} from '../lib/workspaceApi.ts';
import { PendingConfirmation, WorkspaceRecord } from '../types.ts';

interface Props {
  onRequestConfirm: (conf: PendingConfirmation) => void;
}

type ServiceFilter = 'all' | 'drive' | 'docs' | 'sheets' | 'slides' | 'forms';

export const DriveDocsSheetsView: React.FC<Props> = ({ onRequestConfirm }) => {
  const { apiFetch, accessToken, firebaseUser, lastSyncEvent } = useAuth();
  const [filter, setFilter] = useState<ServiceFilter>('all');
  const [records, setRecords] = useState<WorkspaceRecord[]>([]);
  const [selected, setSelected] = useState<WorkspaceRecord | null>(null);
  const [pickerBookmarks, setPickerBookmarks] = useState<FirestorePickerBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Create new document form
  const [createType, setCreateType] = useState<'docs' | 'sheets' | 'slides' | 'forms'>('docs');
  const [newTitle, setNewTitle] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  // Editor state for selected Doc / Sheet / Slide / Form
  const [docAppendText, setDocAppendText] = useState('');
  const [sheetRows, setSheetRows] = useState<string[][]>([]);
  const [sheetTab, setSheetTab] = useState('Sheet1');
  const [slideNotes, setSlideNotes] = useState('');
  const [formResponseNote, setFormResponseNote] = useState('');

  const loadRecords = useCallback(async () => {
    try {
      const res = await apiFetch<{ records: WorkspaceRecord[] }>('/api/records');
      setRecords(res.records);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to load Drive and editor records.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const loadBookmarks = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const bm = await listFirestorePickerBookmarks(firebaseUser.uid);
      setPickerBookmarks(bm);
    } catch {
      // ignore if user has not created bookmarks yet
    }
  }, [firebaseUser]);

  useEffect(() => {
    void loadRecords();
    void loadBookmarks();
  }, [loadRecords, loadBookmarks]);

  const handleOpenPicker = async () => {
    if (!accessToken) {
      setStatusMsg('Connect Google Workspace in the sidebar to open Google Picker.');
      return;
    }
    try {
      const picked = await openGooglePicker(accessToken, { multiSelect: true });
      if (picked.length === 0) return;

      await apiFetch('/api/records', {
        method: 'POST',
        body: JSON.stringify({
          records: picked.map((f) => ({
            service: classifyDriveMime(f.mimeType),
            externalId: f.id,
            title: f.name,
            mimeType: f.mimeType,
            summary: 'Selected via Google Picker',
            webViewLink: f.url || `https://drive.google.com/file/d/${f.id}/view`,
          })),
        }),
      });

      if (firebaseUser?.emailVerified) {
        for (const f of picked) {
          await saveFirestorePickerBookmark(firebaseUser.uid, f).catch(() => undefined);
        }
        await loadBookmarks();
      }
      await loadRecords();
      setStatusMsg(`Imported ${picked.length} file(s) from Google Picker to Cloud SQL and Firestore.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Unable to launch Google Picker.');
    }
  };

  useEffect(() => {
    if (lastSyncEvent && ['records:updated', 'sync:completed'].includes(lastSyncEvent.type)) {
      void loadRecords();
    }
  }, [lastSyncEvent, loadRecords]);

  const handleSyncDrive = async () => {
    if (!accessToken) {
      setStatusMsg('Connect Google Workspace in the sidebar to sync Drive, Docs, Sheets, Slides, and Forms.');
      return;
    }
    setSyncing(true);
    setStatusMsg(null);
    try {
      const files = await fetchDriveFiles(accessToken);
      if (files.length > 0) {
        await apiFetch('/api/records', {
          method: 'POST',
          body: JSON.stringify({
            records: files.map((f) => ({
              service: classifyDriveMime(f.mimeType),
              externalId: f.id,
              title: f.name,
              mimeType: f.mimeType,
              summary: `Modified ${f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : 'recently'}`,
              webViewLink: f.webViewLink || '',
              isStarred: Boolean(f.starred),
            })),
          }),
        });
      }
      await loadRecords();
      setStatusMsg(`Synchronized ${files.length} Drive, Docs, Sheets, Slides, and Forms files to Cloud SQL.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Drive sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleInspectRecord = async (rec: WorkspaceRecord) => {
    setSelected(rec);
    setStatusMsg(null);
    // Preload from SQL payload first
    if (rec.service === 'sheets') {
      const rows = (rec.payload?.rows as string[][]) || [
        ['Column A', 'Column B', 'Column C'],
        ['', '', ''],
      ];
      setSheetRows(rows);
      setSheetTab((rec.payload?.activeTab as string) || 'Sheet1');
    } else if (rec.service === 'slides') {
      setSlideNotes((rec.payload?.notes as string) || '');
    }

    if (!accessToken || rec.externalId.startsWith('local-')) return;

    try {
      if (rec.service === 'docs') {
        const doc = await fetchGoogleDoc(accessToken, rec.externalId);
        const updated = await apiFetch<{ record: WorkspaceRecord }>(`/api/records/${rec.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            summary: doc.text.slice(0, 300) || 'Empty document',
            payload: { ...rec.payload, text: doc.text },
          }),
        });
        setSelected(updated.record);
      } else if (rec.service === 'sheets') {
        const sheet = await fetchGoogleSheet(accessToken, rec.externalId);
        const rows = sheet.rows.length > 0 ? sheet.rows : [['Item', 'Owner', 'Status'], ['', '', '']];
        setSheetRows(rows);
        setSheetTab(sheet.activeTab);
        const updated = await apiFetch<{ record: WorkspaceRecord }>(`/api/records/${rec.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            summary: `Tab "${sheet.activeTab}" · ${rows.length} rows`,
            payload: { ...rec.payload, activeTab: sheet.activeTab, sheetTabs: sheet.sheetTabs, rows },
          }),
        });
        setSelected(updated.record);
      } else if (rec.service === 'slides') {
        const pres = await fetchGooglePresentation(accessToken, rec.externalId);
        const updated = await apiFetch<{ record: WorkspaceRecord }>(`/api/records/${rec.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            summary: `${pres.slides.length} slide(s)`,
            payload: { ...rec.payload, slides: pres.slides },
          }),
        });
        setSelected(updated.record);
      } else if (rec.service === 'forms') {
        const form = await fetchGoogleForm(accessToken, rec.externalId);
        const updated = await apiFetch<{ record: WorkspaceRecord }>(`/api/records/${rec.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            summary: `${form.items.length} question(s) · ${form.responseCount} response(s)`,
            webViewLink: form.responderUri || rec.webViewLink,
            payload: { ...rec.payload, items: form.items, responseCount: form.responseCount },
          }),
        });
        setSelected(updated.record);
      }
      await loadRecords();
    } catch (err: any) {
      setStatusMsg(`Loaded SQL copy. Live Google API fetch note: ${err?.message || 'unavailable'}`);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const title = newTitle.trim();

    onRequestConfirm({
      serviceLabel: `Google ${createType.charAt(0).toUpperCase() + createType.slice(1)}`,
      title: `Create new ${createType} file "${title}"?`,
      description: accessToken
        ? `This will create "${title}" in your Google account and index it into Cloud SQL.`
        : `This will create "${title}" in Cloud SQL.`,
      confirmLabel: 'Create File',
      onConfirm: async () => {
        let externalId = `local-${createType}-${Date.now()}`;
        let webViewLink = '';
        let payload: Record<string, unknown> = {};

        if (accessToken) {
          if (createType === 'docs') {
            const d = await createGoogleDoc(accessToken, title, 'Created in Google Unite.');
            externalId = d.documentId;
            webViewLink = `https://docs.google.com/document/d/${d.documentId}/edit`;
            payload = { text: 'Created in Google Unite.' };
          } else if (createType === 'sheets') {
            const s = await createGoogleSheet(accessToken, title);
            externalId = s.spreadsheetId;
            webViewLink = s.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${s.spreadsheetId}/edit`;
            payload = { activeTab: 'Sheet1', rows: [['Task', 'Owner', 'Status'], ['Kickoff', 'Team', 'Active']] };
          } else if (createType === 'slides') {
            const p = await createGooglePresentation(accessToken, title);
            externalId = p.presentationId;
            webViewLink = `https://docs.google.com/presentation/d/${p.presentationId}/edit`;
            payload = { slides: [{ index: 1, texts: [title] }] };
          } else if (createType === 'forms') {
            const f = await createGoogleForm(accessToken, title);
            externalId = f.formId;
            webViewLink = f.responderUri || '';
            payload = { items: [], responseCount: 0 };
          }
        } else {
          if (createType === 'docs') payload = { text: '' };
          if (createType === 'sheets') payload = { activeTab: 'Sheet1', rows: [['Item', 'Owner', 'Status'], ['', '', '']] };
          if (createType === 'slides') payload = { slides: [{ index: 1, texts: [title] }] };
          if (createType === 'forms') payload = { items: [], responseCount: 0 };
        }

        const res = await apiFetch<{ records: WorkspaceRecord[] }>('/api/records', {
          method: 'POST',
          body: JSON.stringify({
            service: createType,
            externalId,
            title,
            summary: `Created via Google Unite`,
            webViewLink,
            payload,
          }),
        });
        setShowCreate(false);
        setNewTitle('');
        await loadRecords();
        if (res.records?.[0]) setSelected(res.records[0]);
      },
    });
  };

  const handleSaveDocAppend = () => {
    if (!selected || !docAppendText.trim()) return;
    onRequestConfirm({
      serviceLabel: 'Google Docs',
      title: `Update "${selected.title}"?`,
      description: 'Append this paragraph to the Google Doc and synchronize the updated text to Cloud SQL?',
      confirmLabel: 'Update Document',
      onConfirm: async () => {
        if (accessToken && !selected.externalId.startsWith('local-')) {
          await appendGoogleDocText(accessToken, selected.externalId, docAppendText.trim());
        }
        const prevText = (selected.payload?.text as string) || '';
        const nextText = prevText ? `${prevText}\n\n${docAppendText.trim()}` : docAppendText.trim();
        const res = await apiFetch<{ record: WorkspaceRecord }>(`/api/records/${selected.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            summary: nextText.slice(0, 300),
            payload: { ...selected.payload, text: nextText },
          }),
        });
        setSelected(res.record);
        setDocAppendText('');
        await loadRecords();
      },
    });
  };

  const handleSaveSheet = () => {
    if (!selected) return;
    onRequestConfirm({
      serviceLabel: 'Google Sheets',
      title: `Commit Cell Changes to "${selected.title}"?`,
      description: `Write ${sheetRows.length} row(s) to tab "${sheetTab}" and update Cloud SQL?`,
      confirmLabel: 'Save Spreadsheet',
      onConfirm: async () => {
        if (accessToken && !selected.externalId.startsWith('local-')) {
          await updateGoogleSheetValues(accessToken, selected.externalId, sheetTab, sheetRows);
        }
        const res = await apiFetch<{ record: WorkspaceRecord }>(`/api/records/${selected.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            summary: `Tab "${sheetTab}" · ${sheetRows.length} rows`,
            payload: { ...selected.payload, activeTab: sheetTab, rows: sheetRows },
          }),
        });
        setSelected(res.record);
        await loadRecords();
      },
    });
  };

  const handleDeleteRecord = (rec: WorkspaceRecord) => {
    onRequestConfirm({
      serviceLabel: 'Google Drive',
      title: `Delete "${rec.title}"?`,
      description:
        accessToken && !rec.externalId.startsWith('local-')
          ? 'This will permanently delete the file from Google Drive and remove its record from Cloud SQL.'
          : 'This will permanently remove this record from Cloud SQL.',
      confirmLabel: 'Delete Permanently',
      isDestructive: true,
      items: [rec.title, `Service: ${rec.service}`],
      onConfirm: async () => {
        if (accessToken && !rec.externalId.startsWith('local-')) {
          await deleteDriveFile(accessToken, rec.externalId);
        }
        await apiFetch(`/api/records/${rec.id}`, { method: 'DELETE' });
        if (selected?.id === rec.id) setSelected(null);
        await loadRecords();
      },
    });
  };

  const filtered = filter === 'all' ? records : records.filter((r) => r.service === filter);

  const serviceIcon = (s: string) => {
    if (s === 'docs') return <FileText className="w-4 h-4 text-blue-600" />;
    if (s === 'sheets') return <FileSpreadsheet className="w-4 h-4 text-emerald-600" />;
    if (s === 'slides') return <Presentation className="w-4 h-4 text-amber-600" />;
    if (s === 'forms') return <ClipboardList className="w-4 h-4 text-violet-600" />;
    return <FolderOpen className="w-4 h-4 text-slate-600" />;
  };

  return (
    <div className="space-y-4">
      {/* Filter & Actions Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
          {(['all', 'drive', 'docs', 'sheets', 'slides', 'forms'] as ServiceFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                filter === f
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {f === 'all' ? `All (${records.length})` : f}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleOpenPicker()}
            className="h-9 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <FolderSearch className="w-3.5 h-3.5 text-blue-600" />
            Google Picker
          </button>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="h-9 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            New File
          </button>
          <button
            type="button"
            onClick={() => void handleSyncDrive()}
            disabled={syncing}
            className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync Drive Files
          </button>
        </div>
      </div>

      {pickerBookmarks.length > 0 && (
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Firestore Picker Bookmarks:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {pickerBookmarks.map((bm) => (
              <div
                key={bm.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              >
                <a
                  href={bm.webViewLink || `https://drive.google.com/file/d/${bm.fileId}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-600 dark:text-blue-400 hover:underline max-w-[180px] truncate"
                >
                  {bm.name}
                </a>
                <button
                  type="button"
                  onClick={() =>
                    void deleteFirestorePickerBookmark(bm.id).then(() => loadBookmarks())
                  }
                  className="text-slate-400 hover:text-red-600"
                  aria-label={`Remove bookmark ${bm.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {statusMsg && (
        <div className="px-4 py-2.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-xs text-blue-800 dark:text-blue-200">
          {statusMsg}
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreateSubmit}
          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center"
        >
          <select
            value={createType}
            onChange={(e) => setCreateType(e.target.value as typeof createType)}
            className="h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-medium"
          >
            <option value="docs">Google Doc</option>
            <option value="sheets">Google Sheet</option>
            <option value="slides">Google Slides</option>
            <option value="forms">Google Form</option>
          </select>
          <input
            type="text"
            required
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Document title..."
            className="flex-1 h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
          />
          <button
            type="submit"
            className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
          >
            Review &amp; Create
          </button>
        </form>
      )}

      {/* Master-Detail Workbench */}
      {loading ? (
        <div className="h-96 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden min-h-[520px]">
          {/* File List */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No files in this view. Sync Drive or create a new Doc, Sheet, Slide, or Form.
              </div>
            ) : (
              filtered.map((rec) => (
                <button
                  key={rec.id}
                  type="button"
                  onClick={() => void handleInspectRecord(rec)}
                  className={`w-full px-4 py-3 text-left flex items-start gap-3 transition-colors ${
                    selected?.id === rec.id
                      ? 'bg-blue-50/80 dark:bg-blue-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">{serviceIcon(rec.service)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {rec.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      <span className="capitalize">{rec.service}</span> · {rec.summary || 'Synced'}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Editor / Inspector */}
          <div className="lg:col-span-8 p-5 flex flex-col gap-4">
            {!selected ? (
              <div className="m-auto text-center space-y-1 text-slate-500">
                <p className="text-sm font-medium">Select a Drive file, Doc, Sheet, Slide, or Form</p>
                <p className="text-xs">Inspect live Google Workspace content and commit changes to Cloud SQL.</p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                      {selected.service} · Updated {new Date(selected.updatedAt).toLocaleString()}
                    </div>
                    <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {selected.title}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {selected.webViewLink && selected.webViewLink.startsWith('https://') && (
                      <a
                        href={selected.webViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-8 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Open in Google <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteRecord(selected)}
                      className="h-8 w-8 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 flex items-center justify-center"
                      aria-label="Delete file"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Service-specific improved interface */}
                {selected.service === 'docs' && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm whitespace-pre-wrap leading-relaxed min-h-[160px] max-h-72 overflow-y-auto">
                      {(selected.payload?.text as string) || 'No document text loaded yet.'}
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Append Paragraph to Google Doc
                      </label>
                      <textarea
                        rows={3}
                        value={docAppendText}
                        onChange={(e) => setDocAppendText(e.target.value)}
                        placeholder="Write new content to append..."
                        className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                      />
                      <button
                        type="button"
                        onClick={handleSaveDocAppend}
                        disabled={!docAppendText.trim()}
                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" /> Review &amp; Append to Doc
                      </button>
                    </div>
                  </div>
                )}

                {selected.service === 'sheets' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        Active Tab: <span className="font-mono text-slate-900 dark:text-slate-100">{sheetTab}</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setSheetRows((prev) => [
                              ...prev,
                              new Array(Math.max(3, prev[0]?.length || 3)).fill(''),
                            ])
                          }
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
                        >
                          + Row
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveSheet}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5"
                        >
                          <Save className="w-3.5 h-3.5" /> Save Cells
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                      <table className="w-full text-xs border-collapse font-mono tabular-nums">
                        <tbody>
                          {sheetRows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className={rIdx === 0 ? 'bg-slate-100 dark:bg-slate-800 font-semibold' : 'border-t border-slate-200 dark:border-slate-800'}
                            >
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="border-r border-slate-200 dark:border-slate-800 last:border-r-0 p-0">
                                  <input
                                    type="text"
                                    value={cell}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setSheetRows((prev) =>
                                        prev.map((r, ri) =>
                                          ri === rIdx ? r.map((c, ci) => (ci === cIdx ? val : c)) : r
                                        )
                                      );
                                    }}
                                    className="w-full min-w-[110px] px-2.5 py-2 bg-transparent focus:outline-none focus:bg-blue-50/50 dark:focus:bg-blue-950/30"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {selected.service === 'slides' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {((selected.payload?.slides as Array<{ index: number; texts: string[] }>) || [
                        { index: 1, texts: [selected.title] },
                      ]).map((slide) => (
                        <div
                          key={slide.index}
                          className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-1.5"
                        >
                          <div className="font-mono text-[11px] text-slate-500">
                            Slide {slide.index}
                          </div>
                          {slide.texts.length === 0 ? (
                            <p className="text-xs text-slate-400">Blank slide</p>
                          ) : (
                            slide.texts.map((t, i) => (
                              <p key={i} className="text-xs text-slate-800 dark:text-slate-200">
                                {t}
                              </p>
                            ))
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Centralized Speaker &amp; Review Notes (SQL)
                      </label>
                      <textarea
                        rows={2}
                        value={slideNotes}
                        onChange={(e) => setSlideNotes(e.target.value)}
                        className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                        placeholder="Add presentation notes..."
                      />
                      <button
                        type="button"
                        onClick={() =>
                          void apiFetch(`/api/records/${selected.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({
                              payload: { ...selected.payload, notes: slideNotes },
                            }),
                          }).then(() => {
                            setStatusMsg('Saved speaker notes to PostgreSQL.');
                            void loadRecords();
                          })
                        }
                        className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                      >
                        Save Notes to SQL
                      </button>
                    </div>
                  </div>
                )}

                {selected.service === 'forms' && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-500">Total Responses</div>
                        <div className="font-mono text-2xl font-semibold tabular-nums">
                          {(selected.payload?.responseCount as number) ?? 0}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500">
                        {((selected.payload?.items as Array<unknown>) || []).length} Question(s)
                      </div>
                    </div>
                    <div className="space-y-2">
                      {((selected.payload?.items as Array<{ id: string; title: string }>) || []).map(
                        (q, idx) => (
                          <div
                            key={q.id || idx}
                            className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs"
                          >
                            {idx + 1}. {q.title}
                          </div>
                        )
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={formResponseNote}
                        onChange={(e) => setFormResponseNote(e.target.value)}
                        placeholder="Log manual SQL form intake entry..."
                        className="flex-1 h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!formResponseNote.trim()) return;
                          const prevCount = (selected.payload?.responseCount as number) || 0;
                          const prevLogs = (selected.payload?.manualEntries as string[]) || [];
                          void apiFetch(`/api/records/${selected.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({
                              payload: {
                                ...selected.payload,
                                responseCount: prevCount + 1,
                                manualEntries: [...prevLogs, formResponseNote.trim()],
                              },
                            }),
                          }).then(() => {
                            setFormResponseNote('');
                            void loadRecords();
                          });
                        }}
                        className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                      >
                        Log Entry
                      </button>
                    </div>
                  </div>
                )}

                {selected.service === 'drive' && (
                  <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2 text-xs">
                    <div>
                      <span className="text-slate-500">MIME Type: </span>
                      <span className="font-mono">{selected.mimeType || 'Drive File'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">External ID: </span>
                      <span className="font-mono">{selected.externalId}</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 pt-1">{selected.summary}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
