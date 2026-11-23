import React, { useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { CentralAdminView } from './components/CentralAdminView.tsx';
import { ChatHubView } from './components/ChatHubView.tsx';
import { ClassroomContactsView } from './components/ClassroomContactsView.tsx';
import { ConfirmActionModal } from './components/ConfirmActionModal.tsx';
import { DriveDocsSheetsView } from './components/DriveDocsSheetsView.tsx';
import { GeminiWorkspaceView } from './components/GeminiWorkspaceView.tsx';
import { GlobalSearchModal } from './components/GlobalSearchModal.tsx';
import { MailCalendarMeetView } from './components/MailCalendarMeetView.tsx';
import { MapsWorkspace } from './components/MapsWorkspace.tsx';
import { OverviewHub } from './components/OverviewHub.tsx';
import { Shell } from './components/Shell.tsx';
import { TasksKeepView } from './components/TasksKeepView.tsx';
import {
  classifyDriveMime,
  fetchCalendarEvents,
  fetchClassroomCourses,
  fetchDriveFiles,
  fetchGmailMessages,
  fetchGoogleContacts,
  fetchGoogleTasks,
  fetchMyPeopleProfile,
} from './lib/workspaceApi.ts';
import { NavSection, PendingConfirmation } from './types.ts';

function GoogleUniteApp() {
  const { firebaseUser, authReady, accessToken, signIn, apiFetch, refreshUserProfile } = useAuth();
  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [darkMode, setDarkMode] = useState(false);
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState(false);
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  );
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // Listen for Tier 1 & Tier 2 Google Maps quota errors
  useEffect(() => {
    const handler = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  // Load runtime public config if VITE_GOOGLE_MAPS_API_KEY was injected server-side
  useEffect(() => {
    if (mapsApiKey) return;
    fetch('/api/public-config')
      .then((r) => r.json())
      .then((data) => {
        if (data?.mapsApiKey) setMapsApiKey(data.mapsApiKey);
      })
      .catch(() => undefined);
  }, [mapsApiKey]);

  // Sync Tailwind dark class on <html>
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const handleSyncAll = useCallback(async () => {
    if (!firebaseUser) return;
    if (!accessToken) {
      await signIn(true, false);
      return;
    }
    setIsSyncing(true);
    setSyncStatusMessage(null);
    const syncedServices: string[] = [];

    try {
      const [driveRes, calRes, mailRes, taskRes, classRes, contactsRes, meRes] =
        await Promise.allSettled([
          fetchDriveFiles(accessToken),
          fetchCalendarEvents(accessToken),
          fetchGmailMessages(accessToken),
          fetchGoogleTasks(accessToken),
          fetchClassroomCourses(accessToken),
          fetchGoogleContacts(accessToken),
          fetchMyPeopleProfile(accessToken),
        ]);

      if (driveRes.status === 'fulfilled') {
        if (driveRes.value.length > 0) {
          await apiFetch('/api/records', {
            method: 'POST',
            body: JSON.stringify({
              records: driveRes.value.map((f) => ({
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
        syncedServices.push('Drive', 'Docs', 'Sheets', 'Slides', 'Forms', 'Picker');
      }

      if (calRes.status === 'fulfilled') {
        if (calRes.value.length > 0) {
          await apiFetch('/api/calendar', {
            method: 'POST',
            body: JSON.stringify({
              events: calRes.value.map((ev) => ({
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
        syncedServices.push('Calendar');
      }

      if (mailRes.status === 'fulfilled') {
        if (mailRes.value.length > 0) {
          await apiFetch('/api/mail', {
            method: 'POST',
            body: JSON.stringify({ messages: mailRes.value }),
          });
        }
        syncedServices.push('Gmail');
      }

      if (taskRes.status === 'fulfilled') {
        if (taskRes.value.length > 0) {
          await apiFetch('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({ tasks: taskRes.value }),
          });
        }
        syncedServices.push('Tasks');
      }

      if (classRes.status === 'fulfilled') {
        if (classRes.value.length > 0) {
          await apiFetch('/api/classroom/courses', {
            method: 'POST',
            body: JSON.stringify({
              courses: classRes.value.map((c) => ({
                externalId: c.id,
                name: c.name,
                section: c.section || '',
                descriptionHeading: c.descriptionHeading || '',
                room: c.room || '',
                courseState: c.courseState || 'ACTIVE',
                alternateLink: c.alternateLink || '',
                enrollmentCode: c.enrollmentCode || '',
              })),
            }),
          });
        }
        syncedServices.push('Classroom');
      }

      if (contactsRes.status === 'fulfilled' || meRes.status === 'fulfilled') {
        const contactItems = [
          ...(meRes.status === 'fulfilled' ? [meRes.value] : []),
          ...(contactsRes.status === 'fulfilled' ? contactsRes.value : []),
        ];
        if (contactItems.length > 0) {
          await apiFetch('/api/contacts', {
            method: 'POST',
            body: JSON.stringify({ contacts: contactItems }),
          });
        }
        syncedServices.push('Contacts');
      }

      syncedServices.push('Gemini', 'Keep Hub', 'Chat', 'Meet', 'Maps', 'Firebase');
      await apiFetch('/api/sync/status', {
        method: 'POST',
        body: JSON.stringify({ services: syncedServices }),
      });
      await refreshUserProfile();
      setSyncStatusMessage(`Synchronized ${syncedServices.join(', ')} to Cloud SQL.`);
    } catch (err: any) {
      setSyncStatusMessage(err?.message || 'Workspace synchronization encountered an issue.');
    } finally {
      setIsSyncing(false);
    }
  }, [firebaseUser, accessToken, signIn, apiFetch, refreshUserProfile]);

  const quotaBanner = mapsQuotaExceeded ? (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
      <span>
        Google Maps Platform quota reached. If you are the app owner, visit{' '}
        <a
          href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold text-amber-950 hover:text-amber-800"
        >
          maps developer site
        </a>{' '}
        for instructions to update your account.
      </span>
    </div>
  ) : null;

  if (!authReady) {
    return (
      <>
        {quotaBanner}
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-500 text-sm">
          Loading Google Unite...
        </div>
      </>
    );
  }

  if (!firebaseUser) {
    return (
      <>
        {quotaBanner}
        <AuthGate />
      </>
    );
  }

  return (
    <>
      {quotaBanner}
      <Shell
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onSyncAll={() => void handleSyncAll()}
        isSyncing={isSyncing}
        onOpenSearch={() => setSearchOpen(true)}
      >
        {activeSection === 'overview' && (
          <OverviewHub
            onNavigate={setActiveSection}
            onSyncAll={() => void handleSyncAll()}
            isSyncing={isSyncing}
            syncStatusMessage={syncStatusMessage}
          />
        )}
        {activeSection === 'gemini' && <GeminiWorkspaceView />}
        {activeSection === 'maps' && <MapsWorkspace mapsApiKey={mapsApiKey} />}
        {activeSection === 'communications' && (
          <MailCalendarMeetView onRequestConfirm={setConfirmation} />
        )}
        {activeSection === 'drive' && (
          <DriveDocsSheetsView onRequestConfirm={setConfirmation} />
        )}
        {activeSection === 'tasks_keep' && (
          <TasksKeepView onRequestConfirm={setConfirmation} />
        )}
        {activeSection === 'classroom_contacts' && (
          <ClassroomContactsView onRequestConfirm={setConfirmation} />
        )}
        {activeSection === 'chat' && <ChatHubView />}
        {activeSection === 'admin' && <CentralAdminView />}
      </Shell>

      <ConfirmActionModal
        confirmation={confirmation}
        onClose={() => setConfirmation(null)}
      />

      <GlobalSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={setActiveSection}
      />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <GoogleUniteApp />
    </AuthProvider>
  );
}
