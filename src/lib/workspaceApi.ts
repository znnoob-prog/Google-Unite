// Client-side Google Workspace API helpers using in-memory OAuth access tokens

async function googleFetch<T = unknown>(
  url: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 204) {
    return {} as T;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data?.error?.message || `Google API error (${res.status})`;
    const error = new Error(errMsg) as Error & { status?: number; raw?: unknown };
    error.status = res.status;
    error.raw = data;
    throw error;
  }
  return data as T;
}

export function classifyDriveMime(mimeType: string): 'drive' | 'docs' | 'sheets' | 'slides' | 'forms' {
  if (mimeType === 'application/vnd.google-apps.document') return 'docs';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'sheets';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'slides';
  if (mimeType === 'application/vnd.google-apps.form') return 'forms';
  return 'drive';
}

// ---- Google Drive ----
export async function fetchDriveFiles(accessToken: string) {
  const fields = 'files(id,name,mimeType,modifiedTime,webViewLink,starred)';
  const data = await googleFetch<{
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      webViewLink?: string;
      starred?: boolean;
    }>;
  }>(
    `https://www.googleapis.com/drive/v3/files?pageSize=30&orderBy=modifiedTime desc&q=trashed=false&fields=${encodeURIComponent(fields)}`,
    accessToken
  );
  return data.files ?? [];
}

export async function deleteDriveFile(accessToken: string, fileId: string) {
  const safeId = encodeURIComponent(fileId.trim());
  await googleFetch(`https://www.googleapis.com/drive/v3/files/${safeId}`, accessToken, {
    method: 'DELETE',
  });
}

// ---- Google Docs ----
export async function fetchGoogleDoc(accessToken: string, documentId: string) {
  const safeId = encodeURIComponent(documentId.trim());
  const doc = await googleFetch<{
    documentId: string;
    title: string;
    body?: {
      content?: Array<{
        paragraph?: {
          elements?: Array<{ textRun?: { content?: string } }>;
        };
      }>;
    };
  }>(`https://docs.googleapis.com/v1/documents/${safeId}`, accessToken);

  const paragraphs: string[] = [];
  for (const el of doc.body?.content ?? []) {
    if (el.paragraph?.elements) {
      const line = el.paragraph.elements.map((e) => e.textRun?.content ?? '').join('');
      if (line.trim()) paragraphs.push(line.replace(/\n$/, ''));
    }
  }
  return {
    documentId: doc.documentId,
    title: doc.title,
    text: paragraphs.join('\n\n'),
  };
}

export async function createGoogleDoc(accessToken: string, title: string, initialText: string) {
  const created = await googleFetch<{ documentId: string; title: string }>(
    'https://docs.googleapis.com/v1/documents',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ title }),
    }
  );
  if (initialText.trim()) {
    const safeId = encodeURIComponent(created.documentId);
    await googleFetch(
      `https://docs.googleapis.com/v1/documents/${safeId}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: initialText,
              },
            },
          ],
        }),
      }
    );
  }
  return created;
}

export async function appendGoogleDocText(accessToken: string, documentId: string, textToAppend: string) {
  const safeId = encodeURIComponent(documentId.trim());
  const doc = await googleFetch<{ body?: { content?: Array<{ endIndex?: number }> } }>(
    `https://docs.googleapis.com/v1/documents/${safeId}`,
    accessToken
  );
  const contentArr = doc.body?.content ?? [];
  const lastEnd = contentArr.length > 0 ? (contentArr[contentArr.length - 1].endIndex ?? 2) : 2;
  const insertIdx = Math.max(1, lastEnd - 1);

  await googleFetch(
    `https://docs.googleapis.com/v1/documents/${safeId}:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: insertIdx },
              text: `\n${textToAppend}`,
            },
          },
        ],
      }),
    }
  );
}

// ---- Google Sheets ----
export async function fetchGoogleSheet(accessToken: string, spreadsheetId: string) {
  const safeId = encodeURIComponent(spreadsheetId.trim());
  // Fetch metadata first so we never hardcode "Sheet1" (sheets.md best practice)
  const meta = await googleFetch<{
    spreadsheetId: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${safeId}?fields=spreadsheetId,properties.title,sheets.properties`,
    accessToken
  );

  const tabTitle = meta.sheets?.[0]?.properties?.title || 'Sheet1';
  const safeRange = encodeURIComponent(`'${tabTitle}'!A1:J25`);
  const valuesRes = await googleFetch<{ values?: string[][] }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${safeId}/values/${safeRange}`,
    accessToken
  );

  return {
    spreadsheetId: meta.spreadsheetId,
    title: meta.properties?.title || 'Untitled Spreadsheet',
    sheetTabs: (meta.sheets ?? []).map((s) => s.properties?.title || 'Tab'),
    activeTab: tabTitle,
    rows: valuesRes.values ?? [],
  };
}

export async function updateGoogleSheetValues(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  rows: string[][]
) {
  const safeId = encodeURIComponent(spreadsheetId.trim());
  const safeRange = encodeURIComponent(`'${tabName}'!A1`);
  return googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${safeId}/values/${safeRange}?valueInputOption=USER_ENTERED`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({ values: rows }),
    }
  );
}

export async function createGoogleSheet(accessToken: string, title: string) {
  return googleFetch<{ spreadsheetId: string; spreadsheetUrl: string; properties?: { title?: string } }>(
    'https://sheets.googleapis.com/v4/spreadsheets',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ properties: { title } }),
    }
  );
}

// ---- Google Slides ----
export async function fetchGooglePresentation(accessToken: string, presentationId: string) {
  const safeId = encodeURIComponent(presentationId.trim());
  const pres = await googleFetch<{
    presentationId: string;
    title: string;
    slides?: Array<{
      objectId: string;
      pageElements?: Array<{
        shape?: {
          text?: {
            textElements?: Array<{ textRun?: { content?: string } }>;
          };
        };
      }>;
    }>;
  }>(`https://slides.googleapis.com/v1/presentations/${safeId}`, accessToken);

  const slides = (pres.slides ?? []).map((slide, idx) => {
    const texts: string[] = [];
    for (const el of slide.pageElements ?? []) {
      const runs = el.shape?.text?.textElements ?? [];
      const combined = runs.map((r) => r.textRun?.content ?? '').join('').trim();
      if (combined) texts.push(combined);
    }
    return {
      index: idx + 1,
      objectId: slide.objectId,
      texts,
    };
  });

  return {
    presentationId: pres.presentationId,
    title: pres.title,
    slides,
  };
}

export async function createGooglePresentation(accessToken: string, title: string) {
  return googleFetch<{ presentationId: string; title: string }>(
    'https://slides.googleapis.com/v1/presentations',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ title }),
    }
  );
}

// ---- Google Forms ----
export async function fetchGoogleForm(accessToken: string, formId: string) {
  const safeId = encodeURIComponent(formId.trim());
  const [form, responsesRes] = await Promise.all([
    googleFetch<{
      formId: string;
      info?: { title?: string; description?: string };
      items?: Array<{ itemId?: string; title?: string; questionItem?: unknown }>;
      responderUri?: string;
    }>(`https://forms.googleapis.com/v1/forms/${safeId}`, accessToken),
    googleFetch<{ responses?: Array<{ responseId: string; createTime?: string }> }>(
      `https://forms.googleapis.com/v1/forms/${safeId}/responses`,
      accessToken
    ).catch(() => ({ responses: [] })),
  ]);

  return {
    formId: form.formId,
    title: form.info?.title || 'Untitled Form',
    description: form.info?.description || '',
    responderUri: form.responderUri || '',
    items: (form.items ?? []).map((i) => ({ id: i.itemId || '', title: i.title || 'Question' })),
    responseCount: responsesRes.responses?.length ?? 0,
  };
}

export async function createGoogleForm(accessToken: string, title: string) {
  return googleFetch<{ formId: string; info?: { title?: string }; responderUri?: string }>(
    'https://forms.googleapis.com/v1/forms',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ info: { title, documentTitle: title } }),
    }
  );
}

// ---- Google Calendar ----
export async function fetchCalendarEvents(accessToken: string) {
  const timeMin = new Date(Date.now() - 7 * 86400000).toISOString();
  const data = await googleFetch<{
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      location?: string;
      hangoutLink?: string;
      status?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=25&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}`,
    accessToken
  );
  return data.items ?? [];
}

export async function createCalendarEvent(
  accessToken: string,
  payload: {
    summary: string;
    description?: string;
    location?: string;
    startIso: string;
    endIso: string;
  }
) {
  return googleFetch<{ id: string; htmlLink?: string; summary?: string }>(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        summary: payload.summary,
        description: payload.description || '',
        location: payload.location || '',
        start: { dateTime: payload.startIso },
        end: { dateTime: payload.endIso },
      }),
    }
  );
}

export async function deleteCalendarEvent(accessToken: string, eventId: string) {
  const safeId = encodeURIComponent(eventId.trim());
  await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${safeId}`,
    accessToken,
    { method: 'DELETE' }
  );
}

// ---- Gmail ----
function decodeBase64Url(input: string): string {
  try {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function encodeBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function fetchGmailMessages(accessToken: string) {
  const list = await googleFetch<{ messages?: Array<{ id: string; threadId: string }> }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=12',
    accessToken
  );
  const refs = list.messages ?? [];
  const details = await Promise.all(
    refs.map((ref) =>
      googleFetch<{
        id: string;
        threadId: string;
        snippet?: string;
        labelIds?: string[];
        internalDate?: string;
        payload?: {
          headers?: Array<{ name: string; value: string }>;
          body?: { data?: string };
          parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
        };
      }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(ref.id)}?format=full`,
        accessToken
      ).catch(() => null)
    )
  );

  return details.filter(Boolean).map((msg) => {
    const headers = msg!.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    let bodyText = '';
    if (msg!.payload?.body?.data) {
      bodyText = decodeBase64Url(msg!.payload.body.data);
    } else if (msg!.payload?.parts) {
      const plainPart = msg!.payload.parts.find((p) => p.mimeType === 'text/plain');
      if (plainPart?.body?.data) {
        bodyText = decodeBase64Url(plainPart.body.data);
      }
    }

    return {
      externalId: msg!.id,
      threadId: msg!.threadId,
      fromEmail: getHeader('From') || 'Unknown sender',
      toEmail: getHeader('To') || '',
      subject: getHeader('Subject') || '(No subject)',
      snippet: msg!.snippet || '',
      body: bodyText || msg!.snippet || '',
      labels: msg!.labelIds ?? [],
      isUnread: (msg!.labelIds ?? []).includes('UNREAD'),
      receivedAt: msg!.internalDate
        ? new Date(Number(msg!.internalDate)).toISOString()
        : new Date().toISOString(),
    };
  });
}

export async function sendGmailMessage(
  accessToken: string,
  to: string,
  subject: string,
  body: string
) {
  const rawMessage = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n');

  return googleFetch<{ id: string; threadId: string }>(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ raw: encodeBase64Url(rawMessage) }),
    }
  );
}

export async function trashGmailMessage(accessToken: string, messageId: string) {
  const safeId = encodeURIComponent(messageId.trim());
  await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${safeId}/trash`,
    accessToken,
    { method: 'POST' }
  );
}

// ---- Google Tasks ----
export async function fetchGoogleTasks(accessToken: string) {
  const listsRes = await googleFetch<{ items?: Array<{ id: string; title: string }> }>(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=10',
    accessToken
  );
  const lists = listsRes.items ?? [{ id: '@default', title: 'My Tasks' }];
  const primaryList = lists[0] || { id: '@default', title: 'My Tasks' };

  const tasksRes = await googleFetch<{
    items?: Array<{
      id: string;
      title: string;
      notes?: string;
      due?: string;
      status?: string;
    }>;
  }>(
    `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(primaryList.id)}/tasks?maxResults=30&showCompleted=true`,
    accessToken
  );

  return (tasksRes.items ?? []).map((t) => ({
    externalId: t.id,
    listId: primaryList.id,
    listTitle: primaryList.title,
    title: t.title || 'Untitled Task',
    notes: t.notes || '',
    dueDate: t.due ? t.due.slice(0, 10) : '',
    status: t.status === 'completed' ? 'completed' : 'needsAction',
  }));
}

export async function createGoogleTask(
  accessToken: string,
  listId: string,
  title: string,
  notes?: string,
  dueDate?: string
) {
  const safeListId = encodeURIComponent(listId || '@default');
  return googleFetch<{ id: string; title: string }>(
    `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${safeListId}/tasks`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        title,
        notes: notes || undefined,
        due: dueDate ? `${dueDate}T00:00:00.000Z` : undefined,
      }),
    }
  );
}

export async function updateGoogleTaskStatus(
  accessToken: string,
  listId: string,
  taskId: string,
  status: 'needsAction' | 'completed'
) {
  const safeListId = encodeURIComponent(listId || '@default');
  const safeTaskId = encodeURIComponent(taskId);
  return googleFetch(
    `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${safeListId}/tasks/${safeTaskId}`,
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }
  );
}

// ---- Google Meet ----
export async function createGoogleMeetSpace(accessToken: string) {
  return googleFetch<{
    name: string;
    meetingUri: string;
    meetingCode: string;
  }>('https://meet.googleapis.com/v2/spaces', accessToken, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ---- Google Chat (Workspace Business/Enterprise accounts) ----
export async function fetchGoogleChatSpaces(accessToken: string) {
  const data = await googleFetch<{
    spaces?: Array<{ name: string; displayName?: string; type?: string }>;
  }>('https://chat.googleapis.com/v1/spaces', accessToken);
  return data.spaces ?? [];
}

export async function sendGoogleChatApiMessage(
  accessToken: string,
  spaceName: string,
  text: string
) {
  return googleFetch<{ name: string; text: string }>(
    `https://chat.googleapis.com/v1/${spaceName}/messages`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ text }),
    }
  );
}

// ---- Google Keep API (Workspace Enterprise accounts with domain-wide delegation) ----
export async function fetchKeepNotes(accessToken: string) {
  const data = await googleFetch<{
    notes?: Array<{
      name: string;
      title?: string;
      body?: {
        text?: { text?: string };
        list?: { listItems?: Array<{ text?: { text?: string }; checked?: boolean }> };
      };
      createTime?: string;
      updateTime?: string;
    }>;
  }>('https://keep.googleapis.com/v1/notes?pageSize=25', accessToken);

  return (data.notes ?? []).map((note) => {
    const checklist = (note.body?.list?.listItems ?? []).map((item, idx) => ({
      id: `${note.name}-${idx}`,
      text: item.text?.text || '',
      checked: Boolean(item.checked),
    }));
    return {
      externalId: note.name,
      title: note.title || 'Google Keep Note',
      content: note.body?.text?.text || '',
      checklist,
    };
  });
}

export async function createKeepNote(
  accessToken: string,
  title: string,
  text: string
) {
  return googleFetch<{ name: string; title?: string }>(
    'https://keep.googleapis.com/v1/notes',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        title,
        body: { text: { text } },
      }),
    }
  );
}

export async function deleteKeepNote(accessToken: string, noteName: string) {
  await googleFetch(`https://keep.googleapis.com/v1/${noteName}`, accessToken, {
    method: 'DELETE',
  });
}

// ---- Google Classroom API ----
export async function fetchClassroomCourses(accessToken: string) {
  const data = await googleFetch<{
    courses?: Array<{
      id: string;
      name: string;
      section?: string;
      descriptionHeading?: string;
      room?: string;
      courseState?: string;
      alternateLink?: string;
      enrollmentCode?: string;
    }>;
  }>('https://classroom.googleapis.com/v1/courses?pageSize=25', accessToken);
  return data.courses ?? [];
}

export async function createClassroomCourse(
  accessToken: string,
  payload: { name: string; section?: string; room?: string; descriptionHeading?: string }
) {
  return googleFetch<{
    id: string;
    name: string;
    section?: string;
    room?: string;
    courseState?: string;
    alternateLink?: string;
    enrollmentCode?: string;
  }>('https://classroom.googleapis.com/v1/courses', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      name: payload.name,
      section: payload.section || undefined,
      room: payload.room || undefined,
      descriptionHeading: payload.descriptionHeading || undefined,
      ownerId: 'me',
      courseState: 'PROVISIONED',
    }),
  });
}

export async function fetchCourseWork(accessToken: string, courseId: string) {
  const safeId = encodeURIComponent(courseId.trim());
  const data = await googleFetch<{
    courseWork?: Array<{
      id: string;
      title: string;
      description?: string;
      state?: string;
      alternateLink?: string;
      dueDate?: { year?: number; month?: number; day?: number };
    }>;
  }>(`https://classroom.googleapis.com/v1/courses/${safeId}/courseWork?pageSize=25`, accessToken);
  return (data.courseWork ?? []).map((cw) => ({
    externalId: cw.id,
    itemType: 'coursework' as const,
    title: cw.title || 'Untitled Assignment',
    description: cw.description || '',
    state: cw.state || 'PUBLISHED',
    alternateLink: cw.alternateLink || '',
    dueDate:
      cw.dueDate?.year && cw.dueDate?.month && cw.dueDate?.day
        ? `${cw.dueDate.year}-${String(cw.dueDate.month).padStart(2, '0')}-${String(cw.dueDate.day).padStart(2, '0')}`
        : '',
  }));
}

export async function createCourseWork(
  accessToken: string,
  courseId: string,
  payload: { title: string; description?: string }
) {
  const safeId = encodeURIComponent(courseId.trim());
  return googleFetch<{ id: string; title: string; alternateLink?: string }>(
    `https://classroom.googleapis.com/v1/courses/${safeId}/courseWork`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        title: payload.title,
        description: payload.description || '',
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
      }),
    }
  );
}

export async function fetchCourseAnnouncements(accessToken: string, courseId: string) {
  const safeId = encodeURIComponent(courseId.trim());
  const data = await googleFetch<{
    announcements?: Array<{
      id: string;
      text?: string;
      state?: string;
      alternateLink?: string;
    }>;
  }>(`https://classroom.googleapis.com/v1/courses/${safeId}/announcements?pageSize=20`, accessToken);
  return (data.announcements ?? []).map((a) => ({
    externalId: a.id,
    itemType: 'announcement' as const,
    title: (a.text || 'Announcement').slice(0, 80),
    description: a.text || '',
    state: a.state || 'PUBLISHED',
    alternateLink: a.alternateLink || '',
    dueDate: '',
  }));
}

export async function createCourseAnnouncement(
  accessToken: string,
  courseId: string,
  text: string
) {
  const safeId = encodeURIComponent(courseId.trim());
  return googleFetch<{ id: string; text: string; alternateLink?: string }>(
    `https://classroom.googleapis.com/v1/courses/${safeId}/announcements`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ text, state: 'PUBLISHED' }),
    }
  );
}

export async function fetchCourseMaterials(accessToken: string, courseId: string) {
  const safeId = encodeURIComponent(courseId.trim());
  const data = await googleFetch<{
    courseWorkMaterial?: Array<{
      id: string;
      title: string;
      description?: string;
      state?: string;
      alternateLink?: string;
    }>;
  }>(
    `https://classroom.googleapis.com/v1/courses/${safeId}/courseWorkMaterials?pageSize=20`,
    accessToken
  );
  return (data.courseWorkMaterial ?? []).map((m) => ({
    externalId: m.id,
    itemType: 'material' as const,
    title: m.title || 'Course Material',
    description: m.description || '',
    state: m.state || 'PUBLISHED',
    alternateLink: m.alternateLink || '',
    dueDate: '',
  }));
}

// ---- Google Contacts / People API ----
interface PeoplePerson {
  resourceName: string;
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
  addresses?: Array<{ formattedValue?: string }>;
  photos?: Array<{ url?: string }>;
  biographies?: Array<{ value?: string }>;
}

function mapPerson(p: PeoplePerson, source: 'contacts' | 'other' | 'directory') {
  return {
    externalId: p.resourceName,
    displayName: p.names?.[0]?.displayName || p.emailAddresses?.[0]?.value || 'Unnamed Contact',
    email: p.emailAddresses?.[0]?.value || '',
    phone: p.phoneNumbers?.[0]?.value || '',
    organization: p.organizations?.[0]?.name || '',
    jobTitle: p.organizations?.[0]?.title || '',
    address: p.addresses?.[0]?.formattedValue || '',
    photoUrl: p.photos?.[0]?.url || '',
    notes: p.biographies?.[0]?.value || '',
    source,
  };
}

export async function fetchMyPeopleProfile(accessToken: string) {
  const person = await googleFetch<PeoplePerson>(
    'https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses,phoneNumbers,organizations,addresses,photos',
    accessToken
  );
  return mapPerson(person, 'contacts');
}

export async function fetchGoogleContacts(accessToken: string) {
  const [connectionsRes, otherRes] = await Promise.all([
    googleFetch<{ connections?: PeoplePerson[] }>(
      'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations,addresses,photos&pageSize=100',
      accessToken
    ).catch(() => ({ connections: [] })),
    googleFetch<{ otherContacts?: PeoplePerson[] }>(
      'https://people.googleapis.com/v1/otherContacts?readMask=names,emailAddresses,phoneNumbers&pageSize=50',
      accessToken
    ).catch(() => ({ otherContacts: [] })),
  ]);

  const primary = (connectionsRes.connections ?? []).map((p) => mapPerson(p, 'contacts'));
  const other = (otherRes.otherContacts ?? []).map((p) => mapPerson(p, 'other'));
  return [...primary, ...other];
}

export async function createGoogleContact(
  accessToken: string,
  payload: {
    displayName: string;
    email?: string;
    phone?: string;
    organization?: string;
    jobTitle?: string;
  }
) {
  const parts = payload.displayName.trim().split(/\s+/);
  const givenName = parts[0] || payload.displayName.trim();
  const familyName = parts.slice(1).join(' ');
  const created = await googleFetch<PeoplePerson>(
    'https://people.googleapis.com/v1/people:createContact',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        names: [{ givenName, familyName }],
        emailAddresses: payload.email ? [{ value: payload.email }] : undefined,
        phoneNumbers: payload.phone ? [{ value: payload.phone }] : undefined,
        organizations:
          payload.organization || payload.jobTitle
            ? [{ name: payload.organization || '', title: payload.jobTitle || '' }]
            : undefined,
      }),
    }
  );
  return mapPerson(created, 'contacts');
}

export async function deleteGoogleContact(accessToken: string, resourceName: string) {
  await googleFetch(
    `https://people.googleapis.com/v1/${resourceName}:deleteContact`,
    accessToken,
    { method: 'DELETE' }
  );
}

