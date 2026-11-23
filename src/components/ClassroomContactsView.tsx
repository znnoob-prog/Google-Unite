import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Building2,
  ExternalLink,
  FolderSearch,
  GraduationCap,
  Mail,
  Megaphone,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { openGooglePicker } from '../lib/googlePicker.ts';
import {
  createClassroomCourse,
  createCourseAnnouncement,
  createCourseWork,
  createGoogleContact,
  deleteGoogleContact,
  fetchClassroomCourses,
  fetchCourseAnnouncements,
  fetchCourseMaterials,
  fetchCourseWork,
  fetchGoogleContacts,
  fetchMyPeopleProfile,
} from '../lib/workspaceApi.ts';
import {
  ClassroomCourseRecord,
  ClassroomItemRecord,
  ContactRecord,
  PendingConfirmation,
} from '../types.ts';

interface Props {
  onRequestConfirm: (conf: PendingConfirmation) => void;
}

export const ClassroomContactsView: React.FC<Props> = ({ onRequestConfirm }) => {
  const { apiFetch, accessToken, lastSyncEvent } = useAuth();
  const [activeTab, setActiveTab] = useState<'classroom' | 'contacts'>('classroom');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Classroom state
  const [courses, setCourses] = useState<ClassroomCourseRecord[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<ClassroomCourseRecord | null>(null);
  const [courseItems, setCourseItems] = useState<ClassroomItemRecord[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [showNewCourse, setShowNewCourse] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [courseSection, setCourseSection] = useState('');
  const [courseRoom, setCourseRoom] = useState('');
  const [itemType, setItemType] = useState<'coursework' | 'announcement'>('coursework');
  const [itemTitle, setItemTitle] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [attachedMaterials, setAttachedMaterials] = useState<
    Array<{ title: string; url: string; type: string }>
  >([]);

  // Contacts state
  const [contactsList, setContactsList] = useState<ContactRecord[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [contactSearch, setContactSearch] = useState('');
  const [showNewContact, setShowNewContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactOrg, setContactOrg] = useState('');
  const [contactTitle, setContactTitle] = useState('');
  const [contactShared, setContactShared] = useState(false);

  const loadCourses = useCallback(async () => {
    try {
      const res = await apiFetch<{ courses: ClassroomCourseRecord[] }>('/api/classroom/courses');
      setCourses(res.courses);
      setSelectedCourse((prev) => {
        if (!prev) return res.courses[0] ?? null;
        return res.courses.find((c) => c.id === prev.id) ?? res.courses[0] ?? null;
      });
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to load Classroom courses.');
    } finally {
      setLoadingCourses(false);
    }
  }, [apiFetch]);

  const loadCourseItems = useCallback(
    async (courseId: number) => {
      try {
        const res = await apiFetch<{ items: ClassroomItemRecord[] }>(
          `/api/classroom/courses/${courseId}/items`
        );
        setCourseItems(res.items);
      } catch {
        setCourseItems([]);
      }
    },
    [apiFetch]
  );

  const loadContacts = useCallback(async () => {
    try {
      const res = await apiFetch<{ contacts: ContactRecord[] }>('/api/contacts');
      setContactsList(res.contacts);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Failed to load contacts.');
    } finally {
      setLoadingContacts(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadCourses();
    void loadContacts();
  }, [loadCourses, loadContacts]);

  useEffect(() => {
    if (selectedCourse) {
      void loadCourseItems(selectedCourse.id);
    } else {
      setCourseItems([]);
    }
  }, [selectedCourse, loadCourseItems]);

  useEffect(() => {
    if (!lastSyncEvent) return;
    if (lastSyncEvent.type === 'classroom:updated' || lastSyncEvent.type === 'sync:completed') {
      void loadCourses();
      if (selectedCourse) void loadCourseItems(selectedCourse.id);
    }
    if (lastSyncEvent.type === 'contacts:updated' || lastSyncEvent.type === 'sync:completed') {
      void loadContacts();
    }
  }, [lastSyncEvent, loadCourses, loadCourseItems, loadContacts, selectedCourse]);

  // ---- Classroom Actions ----
  const handleSyncClassroom = async () => {
    if (!accessToken) {
      setStatusMsg('Connect Google Workspace in the sidebar to sync Google Classroom.');
      return;
    }
    setSyncing(true);
    setStatusMsg(null);
    try {
      const remoteCourses = await fetchClassroomCourses(accessToken);
      if (remoteCourses.length > 0) {
        const savedRes = await apiFetch<{ courses: ClassroomCourseRecord[] }>(
          '/api/classroom/courses',
          {
            method: 'POST',
            body: JSON.stringify({
              courses: remoteCourses.map((c) => ({
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
          }
        );

        for (const savedCourse of savedRes.courses.slice(0, 6)) {
          if (savedCourse.externalId.startsWith('local-')) continue;
          const [cw, ann, mat] = await Promise.all([
            fetchCourseWork(accessToken, savedCourse.externalId).catch(() => []),
            fetchCourseAnnouncements(accessToken, savedCourse.externalId).catch(() => []),
            fetchCourseMaterials(accessToken, savedCourse.externalId).catch(() => []),
          ]);
          const combined = [...cw, ...ann, ...mat];
          if (combined.length > 0) {
            await apiFetch(`/api/classroom/courses/${savedCourse.id}/items`, {
              method: 'POST',
              body: JSON.stringify({ items: combined }),
            });
          }
        }
      }
      await loadCourses();
      setStatusMsg(`Synchronized ${remoteCourses.length} Google Classroom course(s) to Cloud SQL.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Google Classroom sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateCourse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseName.trim()) return;
    const name = courseName.trim();

    onRequestConfirm({
      serviceLabel: 'Google Classroom',
      title: `Create course "${name}"?`,
      description: accessToken
        ? 'Create this class in Google Classroom and persist it to Cloud SQL?'
        : 'Create this class record in Cloud SQL?',
      confirmLabel: 'Create Course',
      onConfirm: async () => {
        let externalId = `local-course-${Date.now()}`;
        let alternateLink = '';
        let enrollmentCode = '';
        let courseState = 'ACTIVE';

        if (accessToken) {
          const created = await createClassroomCourse(accessToken, {
            name,
            section: courseSection.trim(),
            room: courseRoom.trim(),
          });
          externalId = created.id;
          alternateLink = created.alternateLink || '';
          enrollmentCode = created.enrollmentCode || '';
          courseState = created.courseState || 'PROVISIONED';
        }

        await apiFetch('/api/classroom/courses', {
          method: 'POST',
          body: JSON.stringify({
            externalId,
            name,
            section: courseSection.trim(),
            room: courseRoom.trim(),
            courseState,
            alternateLink,
            enrollmentCode,
          }),
        });
        setCourseName('');
        setCourseSection('');
        setCourseRoom('');
        setShowNewCourse(false);
        await loadCourses();
      },
    });
  };

  const handleAttachPickerToCourseItem = async () => {
    if (!accessToken) {
      setStatusMsg('Connect Google Workspace first to open Google Picker.');
      return;
    }
    try {
      const files = await openGooglePicker(accessToken, { multiSelect: true });
      if (files.length === 0) return;
      setAttachedMaterials((prev) => [
        ...prev,
        ...files.map((f) => ({
          title: f.name,
          url: f.url || `https://drive.google.com/file/d/${f.id}/view`,
          type: f.mimeType,
        })),
      ]);
      setStatusMsg(`Attached ${files.length} Drive file(s) via Google Picker.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Google Picker could not be opened.');
    }
  };

  const handleCreateCourseItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourse) return;
    const titleVal = itemTitle.trim();
    const descVal = itemDesc.trim();
    if (itemType === 'coursework' && !titleVal) return;
    if (itemType === 'announcement' && !descVal && !titleVal) return;

    onRequestConfirm({
      serviceLabel: 'Google Classroom',
      title:
        itemType === 'coursework'
          ? `Publish assignment "${titleVal}" to ${selectedCourse.name}?`
          : `Post announcement to ${selectedCourse.name}?`,
      description:
        accessToken && !selectedCourse.externalId.startsWith('local-')
          ? 'Publish directly to Google Classroom and save in Cloud SQL?'
          : 'Save this item in Cloud SQL?',
      confirmLabel: 'Publish',
      onConfirm: async () => {
        let externalId = `local-${itemType}-${Date.now()}`;
        let alternateLink = '';

        if (accessToken && !selectedCourse.externalId.startsWith('local-')) {
          if (itemType === 'coursework') {
            const cw = await createCourseWork(accessToken, selectedCourse.externalId, {
              title: titleVal,
              description: descVal,
            });
            externalId = cw.id;
            alternateLink = cw.alternateLink || '';
          } else {
            const ann = await createCourseAnnouncement(
              accessToken,
              selectedCourse.externalId,
              descVal || titleVal
            );
            externalId = ann.id;
            alternateLink = ann.alternateLink || '';
          }
        }

        await apiFetch(`/api/classroom/courses/${selectedCourse.id}/items`, {
          method: 'POST',
          body: JSON.stringify({
            itemType,
            externalId,
            title: titleVal || descVal.slice(0, 80),
            description: descVal,
            alternateLink,
            materials: attachedMaterials,
          }),
        });
        setItemTitle('');
        setItemDesc('');
        setAttachedMaterials([]);
        await loadCourseItems(selectedCourse.id);
      },
    });
  };

  const handleDeleteCourse = (course: ClassroomCourseRecord) => {
    onRequestConfirm({
      serviceLabel: 'Google Classroom',
      title: `Remove "${course.name}" from Google Unite?`,
      description: 'Remove this course and its cached items from Cloud SQL?',
      confirmLabel: 'Remove Course',
      isDestructive: true,
      onConfirm: async () => {
        await apiFetch(`/api/classroom/courses/${course.id}`, { method: 'DELETE' });
        await loadCourses();
      },
    });
  };

  // ---- Contacts Actions ----
  const handleSyncContacts = async () => {
    if (!accessToken) {
      setStatusMsg('Connect Google Workspace in the sidebar to sync Google Contacts.');
      return;
    }
    setSyncing(true);
    setStatusMsg(null);
    try {
      const [me, list] = await Promise.all([
        fetchMyPeopleProfile(accessToken).catch(() => null),
        fetchGoogleContacts(accessToken),
      ]);
      const combined = me ? [me, ...list] : list;
      if (combined.length > 0) {
        await apiFetch('/api/contacts', {
          method: 'POST',
          body: JSON.stringify({ contacts: combined }),
        });
      }
      await loadContacts();
      setStatusMsg(`Synchronized ${combined.length} Google Contacts profile(s) to Cloud SQL.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Google Contacts sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim()) return;
    const name = contactName.trim();

    onRequestConfirm({
      serviceLabel: 'Google Contacts',
      title: `Add contact "${name}"?`,
      description: accessToken
        ? 'Create this contact in Google Contacts (People API) and save to Cloud SQL?'
        : 'Save this contact in Cloud SQL?',
      confirmLabel: 'Save Contact',
      onConfirm: async () => {
        let payload = {
          externalId: `local-contact-${Date.now()}`,
          displayName: name,
          email: contactEmail.trim(),
          phone: contactPhone.trim(),
          organization: contactOrg.trim(),
          jobTitle: contactTitle.trim(),
          source: 'manual',
        };

        if (accessToken) {
          const created = await createGoogleContact(accessToken, {
            displayName: name,
            email: contactEmail.trim(),
            phone: contactPhone.trim(),
            organization: contactOrg.trim(),
            jobTitle: contactTitle.trim(),
          });
          payload = { ...created, source: 'contacts' };
        }

        await apiFetch('/api/contacts', {
          method: 'POST',
          body: JSON.stringify({ ...payload, isShared: contactShared }),
        });
        setContactName('');
        setContactEmail('');
        setContactPhone('');
        setContactOrg('');
        setContactTitle('');
        setShowNewContact(false);
        await loadContacts();
      },
    });
  };

  const handleDeleteContact = (c: ContactRecord) => {
    onRequestConfirm({
      serviceLabel: 'Google Contacts',
      title: `Delete contact "${c.displayName}"?`,
      description:
        accessToken && c.externalId.startsWith('people/')
          ? 'This will permanently delete the contact from Google Contacts and remove it from Cloud SQL.'
          : 'Remove this contact from Cloud SQL?',
      confirmLabel: 'Delete Contact',
      isDestructive: true,
      onConfirm: async () => {
        if (accessToken && c.externalId.startsWith('people/')) {
          await deleteGoogleContact(accessToken, c.externalId);
        }
        await apiFetch(`/api/contacts/${c.id}`, { method: 'DELETE' });
        await loadContacts();
      },
    });
  };

  const q = contactSearch.trim().toLowerCase();
  const filteredContacts = q
    ? contactsList.filter(
        (c) =>
          c.displayName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.organization.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q)
      )
    : contactsList;

  return (
    <div className="space-y-4">
      {/* Sub-navigation & Sync Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('classroom')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'classroom'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            Google Classroom ({courses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contacts')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              activeTab === 'contacts'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Google Contacts ({contactsList.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'classroom' ? (
            <>
              <button
                type="button"
                onClick={() => setShowNewCourse((v) => !v)}
                className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> New Course
              </button>
              <button
                type="button"
                onClick={() => void handleSyncClassroom()}
                disabled={syncing}
                className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                Sync Classroom
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowNewContact((v) => !v)}
                className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium inline-flex items-center gap-1.5"
              >
                <UserPlus className="w-3.5 h-3.5" /> New Contact
              </button>
              <button
                type="button"
                onClick={() => void handleSyncContacts()}
                disabled={syncing}
                className="h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                Sync Contacts
              </button>
            </>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="px-4 py-2.5 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-xs text-blue-800 dark:text-blue-200">
          {statusMsg}
        </div>
      )}

      {activeTab === 'classroom' ? (
        <div className="space-y-4">
          {showNewCourse && (
            <form
              onSubmit={handleCreateCourse}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 grid grid-cols-1 sm:grid-cols-4 gap-3"
            >
              <input
                type="text"
                required
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                placeholder="Course name (e.g. CS 101)"
                className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <input
                type="text"
                value={courseSection}
                onChange={(e) => setCourseSection(e.target.value)}
                placeholder="Section / Cohort"
                className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <input
                type="text"
                value={courseRoom}
                onChange={(e) => setCourseRoom(e.target.value)}
                placeholder="Room"
                className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
              <button
                type="submit"
                className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
              >
                Review &amp; Create
              </button>
            </form>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden min-h-[500px]">
            {/* Courses List */}
            <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 max-h-[600px] overflow-y-auto">
              {loadingCourses ? (
                <div className="p-6 text-xs text-slate-500">Loading courses...</div>
              ) : courses.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No courses yet. Sync Google Classroom or create a new course.
                </div>
              ) : (
                courses.map((course) => (
                  <button
                    key={course.id}
                    type="button"
                    onClick={() => setSelectedCourse(course)}
                    className={`w-full px-4 py-3.5 text-left transition-colors ${
                      selectedCourse?.id === course.id
                        ? 'bg-blue-50/80 dark:bg-blue-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {course.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {[course.section, course.room, course.courseState].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Course Stream & Coursework */}
            <div className="lg:col-span-8 p-5 space-y-5">
              {!selectedCourse ? (
                <div className="h-full flex items-center justify-center text-center text-sm text-slate-500">
                  Select a course to inspect coursework, announcements, and materials.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {selectedCourse.courseState}
                        {selectedCourse.enrollmentCode
                          ? ` · Code: ${selectedCourse.enrollmentCode}`
                          : ''}
                      </div>
                      <h2 className="font-display text-lg font-semibold">{selectedCourse.name}</h2>
                      {(selectedCourse.section || selectedCourse.room) && (
                        <p className="text-xs text-slate-500">
                          {[selectedCourse.section, selectedCourse.room].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedCourse.alternateLink && (
                        <a
                          href={selectedCourse.alternateLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-8 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          Open Classroom <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteCourse(selectedCourse)}
                        className="h-8 w-8 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center justify-center"
                        aria-label="Remove course"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Post Coursework or Announcement */}
                  <form
                    onSubmit={handleCreateCourseItem}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setItemType('coursework')}
                          className={`px-2.5 py-1 rounded text-xs font-medium inline-flex items-center gap-1 ${
                            itemType === 'coursework'
                              ? 'bg-blue-600 text-white'
                              : 'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <BookOpen className="w-3 h-3" /> Coursework
                        </button>
                        <button
                          type="button"
                          onClick={() => setItemType('announcement')}
                          className={`px-2.5 py-1 rounded text-xs font-medium inline-flex items-center gap-1 ${
                            itemType === 'announcement'
                              ? 'bg-blue-600 text-white'
                              : 'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <Megaphone className="w-3 h-3" /> Announcement
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleAttachPickerToCourseItem()}
                        className="h-8 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium inline-flex items-center gap-1.5"
                      >
                        <FolderSearch className="w-3.5 h-3.5 text-blue-600" />
                        Attach via Google Picker
                      </button>
                    </div>

                    {itemType === 'coursework' && (
                      <input
                        type="text"
                        required
                        value={itemTitle}
                        onChange={(e) => setItemTitle(e.target.value)}
                        placeholder="Assignment title..."
                        className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                      />
                    )}
                    <textarea
                      rows={2}
                      value={itemDesc}
                      onChange={(e) => setItemDesc(e.target.value)}
                      placeholder={
                        itemType === 'coursework'
                          ? 'Assignment instructions...'
                          : 'Write an announcement for the class...'
                      }
                      className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                    />
                    {attachedMaterials.length > 0 && (
                      <div className="space-y-1">
                        {attachedMaterials.map((m, idx) => (
                          <div
                            key={`${m.url}-${idx}`}
                            className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                          >
                            <span className="truncate">{m.title}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setAttachedMaterials((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="text-red-500 ml-2"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        className="h-8 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                      >
                        Review &amp; Publish
                      </button>
                    </div>
                  </form>

                  {/* Course Items List */}
                  <div className="space-y-2.5">
                    {courseItems.length === 0 ? (
                      <div className="p-6 rounded-lg border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
                        No coursework, announcements, or materials recorded for this class yet.
                      </div>
                    ) : (
                      courseItems.map((item) => (
                        <div
                          key={item.id}
                          className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[11px] font-mono uppercase text-blue-600 dark:text-blue-400">
                                {item.itemType}
                                {item.dueDate ? ` · Due ${item.dueDate}` : ''}
                              </div>
                              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                {item.title}
                              </div>
                            </div>
                            {item.alternateLink && (
                              <a
                                href={item.alternateLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 shrink-0"
                              >
                                View <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                              {item.description}
                            </p>
                          )}
                          {item.materials?.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-1">
                              {item.materials.map((m, idx) => (
                                <a
                                  key={idx}
                                  href={m.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                                >
                                  {m.title} <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {showNewContact && (
            <form
              onSubmit={handleCreateContact}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <input
                  type="text"
                  required
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Full name *"
                  className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="Email address"
                  className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Phone number"
                  className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
                <input
                  type="text"
                  value={contactOrg}
                  onChange={(e) => setContactOrg(e.target.value)}
                  placeholder="Organization"
                  className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
                <input
                  type="text"
                  value={contactTitle}
                  onChange={(e) => setContactTitle(e.target.value)}
                  placeholder="Role / Title"
                  className="h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={contactShared}
                    onChange={(e) => setContactShared(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Share contact across Google Unite accounts
                </label>
                <button
                  type="submit"
                  className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
                >
                  Review &amp; Save Contact
                </button>
              </div>
            </form>
          )}

          {/* Contacts Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Search contacts by name, email, phone, or organization..."
              className="w-full h-10 pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs"
            />
          </div>

          {loadingContacts ? (
            <div className="h-64 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
          ) : filteredContacts.length === 0 ? (
            <div className="p-10 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-sm text-slate-500">
              No contacts found. Sync Google Contacts or add a contact above.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredContacts.map((c) => (
                <div
                  key={c.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {c.photoUrl ? (
                        <img
                          src={c.photoUrl}
                          alt={c.displayName}
                          className="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 flex items-center justify-center font-display font-semibold text-sm shrink-0">
                          {c.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {c.displayName}
                        </h3>
                        {(c.jobTitle || c.organization) && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
                            <Building2 className="w-3 h-3 shrink-0" />
                            <span className="truncate">
                              {[c.jobTitle, c.organization].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteContact(c)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 shrink-0"
                      aria-label={`Delete ${c.displayName}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 pt-1">
                    {c.email && (
                      <div className="flex items-center gap-2 truncate">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate font-mono">{c.email}</span>
                      </div>
                    )}
                    {c.phone && (
                      <div className="flex items-center gap-2 truncate">
                        <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate font-mono">{c.phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="capitalize">{c.source}</span>
                    <span>{c.isShared ? 'Shared' : 'Private'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
