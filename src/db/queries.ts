import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  calendarEvents,
  chatMessages,
  chatSpaces,
  ChecklistItem,
  classroomCourses,
  classroomItems,
  ClassroomMaterialLink,
  contacts,
  geminiMessages,
  geminiThreads,
  mailMessages,
  mapLocations,
  meetSessions,
  notes,
  tasks,
  users,
  workspaceRecords,
} from './schema.ts';

// ---- Workspace Records (Drive, Docs, Sheets, Slides, Forms) ----
export async function listWorkspaceRecords(userId: number, service?: string, includeAllForAdmin = false) {
  try {
    if (includeAllForAdmin) {
      if (service) {
        return await db
          .select()
          .from(workspaceRecords)
          .where(eq(workspaceRecords.service, service))
          .orderBy(desc(workspaceRecords.updatedAt));
      }
      return await db
        .select()
        .from(workspaceRecords)
        .orderBy(desc(workspaceRecords.updatedAt));
    }

    const ownerOrShared = or(
      eq(workspaceRecords.userId, userId),
      eq(workspaceRecords.isShared, true)
    );

    if (service) {
      return await db
        .select()
        .from(workspaceRecords)
        .where(and(ownerOrShared, eq(workspaceRecords.service, service)))
        .orderBy(desc(workspaceRecords.updatedAt));
    }

    return await db
      .select()
      .from(workspaceRecords)
      .where(ownerOrShared)
      .orderBy(desc(workspaceRecords.updatedAt));
  } catch (error) {
    console.error('Database query failed (listWorkspaceRecords):', error);
    throw new Error('Failed to load workspace records.', { cause: error });
  }
}

export async function upsertWorkspaceRecord(input: {
  userId: number;
  service: string;
  externalId: string;
  title: string;
  mimeType?: string;
  summary?: string;
  webViewLink?: string;
  payload?: Record<string, unknown>;
  isStarred?: boolean;
  isShared?: boolean;
}) {
  try {
    const result = await db
      .insert(workspaceRecords)
      .values({
        userId: input.userId,
        service: input.service,
        externalId: input.externalId,
        title: input.title,
        mimeType: input.mimeType ?? '',
        summary: input.summary ?? '',
        webViewLink: input.webViewLink ?? '',
        payload: input.payload ?? {},
        isStarred: input.isStarred ?? false,
        isShared: input.isShared ?? false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workspaceRecords.userId, workspaceRecords.service, workspaceRecords.externalId],
        set: {
          title: input.title,
          mimeType: input.mimeType ?? '',
          summary: input.summary ?? '',
          webViewLink: input.webViewLink ?? '',
          payload: input.payload ?? {},
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query failed (upsertWorkspaceRecord):', error);
    throw new Error('Failed to save workspace record.', { cause: error });
  }
}

export async function updateWorkspaceRecordById(
  id: number,
  userId: number,
  isAdmin: boolean,
  updates: {
    title?: string;
    summary?: string;
    payload?: Record<string, unknown>;
    isStarred?: boolean;
    isShared?: boolean;
  }
) {
  try {
    const condition = isAdmin
      ? eq(workspaceRecords.id, id)
      : and(eq(workspaceRecords.id, id), eq(workspaceRecords.userId, userId));

    const updated = await db
      .update(workspaceRecords)
      .set({ ...updates, updatedAt: new Date() })
      .where(condition)
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Database query failed (updateWorkspaceRecordById):', error);
    throw new Error('Failed to update workspace record.', { cause: error });
  }
}

export async function deleteWorkspaceRecordById(id: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(workspaceRecords.id, id)
      : and(eq(workspaceRecords.id, id), eq(workspaceRecords.userId, userId));
    const deleted = await db.delete(workspaceRecords).where(condition).returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteWorkspaceRecordById):', error);
    throw new Error('Failed to delete workspace record.', { cause: error });
  }
}

// ---- Calendar Events ----
export async function listCalendarEvents(userId: number) {
  try {
    return await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.userId, userId))
      .orderBy(calendarEvents.startTime);
  } catch (error) {
    console.error('Database query failed (listCalendarEvents):', error);
    throw new Error('Failed to load calendar events.', { cause: error });
  }
}

export async function upsertCalendarEvent(input: {
  userId: number;
  externalId: string;
  title: string;
  description?: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  meetLink?: string;
  status?: string;
}) {
  try {
    const result = await db
      .insert(calendarEvents)
      .values({
        userId: input.userId,
        externalId: input.externalId,
        title: input.title,
        description: input.description ?? '',
        location: input.location ?? '',
        startTime: input.startTime,
        endTime: input.endTime,
        meetLink: input.meetLink ?? '',
        status: input.status ?? 'confirmed',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [calendarEvents.userId, calendarEvents.externalId],
        set: {
          title: input.title,
          description: input.description ?? '',
          location: input.location ?? '',
          startTime: input.startTime,
          endTime: input.endTime,
          meetLink: input.meetLink ?? '',
          status: input.status ?? 'confirmed',
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query failed (upsertCalendarEvent):', error);
    throw new Error('Failed to save calendar event.', { cause: error });
  }
}

export async function deleteCalendarEventById(id: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(calendarEvents.id, id)
      : and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId));
    const deleted = await db.delete(calendarEvents).where(condition).returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteCalendarEventById):', error);
    throw new Error('Failed to delete calendar event.', { cause: error });
  }
}

// ---- Gmail Messages ----
export async function listMailMessages(userId: number) {
  try {
    return await db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.userId, userId))
      .orderBy(desc(mailMessages.receivedAt));
  } catch (error) {
    console.error('Database query failed (listMailMessages):', error);
    throw new Error('Failed to load email messages.', { cause: error });
  }
}

export async function upsertMailMessage(input: {
  userId: number;
  externalId: string;
  threadId?: string;
  fromEmail: string;
  toEmail?: string;
  subject: string;
  snippet?: string;
  body?: string;
  labels?: string[];
  isUnread?: boolean;
  receivedAt?: Date;
}) {
  try {
    const result = await db
      .insert(mailMessages)
      .values({
        userId: input.userId,
        externalId: input.externalId,
        threadId: input.threadId ?? '',
        fromEmail: input.fromEmail,
        toEmail: input.toEmail ?? '',
        subject: input.subject,
        snippet: input.snippet ?? '',
        body: input.body ?? '',
        labels: input.labels ?? [],
        isUnread: input.isUnread ?? true,
        receivedAt: input.receivedAt ?? new Date(),
      })
      .onConflictDoUpdate({
        target: [mailMessages.userId, mailMessages.externalId],
        set: {
          subject: input.subject,
          snippet: input.snippet ?? '',
          body: input.body ?? '',
          labels: input.labels ?? [],
          isUnread: input.isUnread ?? true,
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query failed (upsertMailMessage):', error);
    throw new Error('Failed to save email message.', { cause: error });
  }
}

export async function markMailReadStatus(id: number, userId: number, isUnread: boolean) {
  try {
    const updated = await db
      .update(mailMessages)
      .set({ isUnread })
      .where(and(eq(mailMessages.id, id), eq(mailMessages.userId, userId)))
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Database query failed (markMailReadStatus):', error);
    throw new Error('Failed to update email status.', { cause: error });
  }
}

export async function deleteMailMessageById(id: number, userId: number) {
  try {
    const deleted = await db
      .delete(mailMessages)
      .where(and(eq(mailMessages.id, id), eq(mailMessages.userId, userId)))
      .returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteMailMessageById):', error);
    throw new Error('Failed to remove email message.', { cause: error });
  }
}

// ---- Tasks ----
export async function listTasks(userId: number) {
  try {
    return await db
      .select()
      .from(tasks)
      .where(eq(tasks.userId, userId))
      .orderBy(desc(tasks.updatedAt));
  } catch (error) {
    console.error('Database query failed (listTasks):', error);
    throw new Error('Failed to load tasks.', { cause: error });
  }
}

export async function upsertTask(input: {
  userId: number;
  externalId: string;
  listId?: string;
  listTitle?: string;
  title: string;
  notes?: string;
  dueDate?: string;
  status?: string;
  priority?: string;
}) {
  try {
    const result = await db
      .insert(tasks)
      .values({
        userId: input.userId,
        externalId: input.externalId,
        listId: input.listId ?? '@default',
        listTitle: input.listTitle ?? 'My Tasks',
        title: input.title,
        notes: input.notes ?? '',
        dueDate: input.dueDate ?? '',
        status: input.status ?? 'needsAction',
        priority: input.priority ?? 'medium',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [tasks.userId, tasks.externalId],
        set: {
          listTitle: input.listTitle ?? 'My Tasks',
          title: input.title,
          notes: input.notes ?? '',
          dueDate: input.dueDate ?? '',
          status: input.status ?? 'needsAction',
          priority: input.priority ?? 'medium',
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query failed (upsertTask):', error);
    throw new Error('Failed to save task.', { cause: error });
  }
}

export async function updateTaskById(
  id: number,
  userId: number,
  updates: { title?: string; notes?: string; status?: string; priority?: string; dueDate?: string }
) {
  try {
    const updated = await db
      .update(tasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Database query failed (updateTaskById):', error);
    throw new Error('Failed to update task.', { cause: error });
  }
}

export async function deleteTaskById(id: number, userId: number) {
  try {
    const deleted = await db
      .delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteTaskById):', error);
    throw new Error('Failed to delete task.', { cause: error });
  }
}

// ---- Notes (Google Keep Hub) ----
export async function listNotes(userId: number) {
  try {
    return await db
      .select()
      .from(notes)
      .where(or(eq(notes.userId, userId), eq(notes.isShared, true)))
      .orderBy(desc(notes.isPinned), desc(notes.updatedAt));
  } catch (error) {
    console.error('Database query failed (listNotes):', error);
    throw new Error('Failed to load notes.', { cause: error });
  }
}

export async function createNote(input: {
  userId: number;
  externalId?: string;
  title: string;
  content: string;
  checklist?: ChecklistItem[];
  color?: string;
  isPinned?: boolean;
  isShared?: boolean;
}) {
  try {
    if (input.externalId) {
      const existing = await db
        .select()
        .from(notes)
        .where(and(eq(notes.userId, input.userId), eq(notes.externalId, input.externalId)))
        .limit(1);
      if (existing[0]) {
        const updated = await db
          .update(notes)
          .set({
            title: input.title,
            content: input.content,
            checklist: input.checklist ?? [],
            updatedAt: new Date(),
          })
          .where(eq(notes.id, existing[0].id))
          .returning();
        return updated[0];
      }
    }
    const inserted = await db
      .insert(notes)
      .values({
        userId: input.userId,
        externalId: input.externalId ?? '',
        title: input.title,
        content: input.content,
        checklist: input.checklist ?? [],
        color: input.color ?? 'slate',
        isPinned: input.isPinned ?? false,
        isShared: input.isShared ?? false,
        updatedAt: new Date(),
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createNote):', error);
    throw new Error('Failed to create note.', { cause: error });
  }
}

export async function updateNoteById(
  id: number,
  userId: number,
  isAdmin: boolean,
  updates: {
    title?: string;
    content?: string;
    checklist?: ChecklistItem[];
    color?: string;
    isPinned?: boolean;
    isShared?: boolean;
  }
) {
  try {
    const condition = isAdmin
      ? eq(notes.id, id)
      : and(eq(notes.id, id), or(eq(notes.userId, userId), eq(notes.isShared, true)));
    const updated = await db
      .update(notes)
      .set({ ...updates, updatedAt: new Date() })
      .where(condition)
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Database query failed (updateNoteById):', error);
    throw new Error('Failed to update note.', { cause: error });
  }
}

export async function deleteNoteById(id: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(notes.id, id)
      : and(eq(notes.id, id), eq(notes.userId, userId));
    const deleted = await db.delete(notes).where(condition).returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteNoteById):', error);
    throw new Error('Failed to delete note.', { cause: error });
  }
}

// ---- Chat Spaces & Messages ----
export async function listChatSpaces() {
  try {
    return await db.select().from(chatSpaces).orderBy(chatSpaces.id);
  } catch (error) {
    console.error('Database query failed (listChatSpaces):', error);
    throw new Error('Failed to load chat spaces.', { cause: error });
  }
}

export async function createChatSpace(input: {
  slug: string;
  name: string;
  description?: string;
  externalSpaceName?: string;
  createdByUserId: number;
}) {
  try {
    const inserted = await db
      .insert(chatSpaces)
      .values({
        slug: input.slug,
        name: input.name,
        description: input.description ?? '',
        externalSpaceName: input.externalSpaceName ?? '',
        createdByUserId: input.createdByUserId,
      })
      .onConflictDoUpdate({
        target: chatSpaces.slug,
        set: {
          name: input.name,
          description: input.description ?? '',
        },
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createChatSpace):', error);
    throw new Error('Failed to create chat space.', { cause: error });
  }
}

export async function listChatMessages(spaceId: number) {
  try {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.spaceId, spaceId))
      .orderBy(chatMessages.createdAt)
      .limit(120);
  } catch (error) {
    console.error('Database query failed (listChatMessages):', error);
    throw new Error('Failed to load chat messages.', { cause: error });
  }
}

export async function createChatMessage(input: {
  spaceId: number;
  userId: number;
  senderName: string;
  senderEmail: string;
  content: string;
  externalMessageName?: string;
}) {
  try {
    const inserted = await db
      .insert(chatMessages)
      .values({
        spaceId: input.spaceId,
        userId: input.userId,
        senderName: input.senderName,
        senderEmail: input.senderEmail,
        content: input.content,
        externalMessageName: input.externalMessageName ?? '',
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createChatMessage):', error);
    throw new Error('Failed to send chat message.', { cause: error });
  }
}

// ---- Meet Sessions ----
export async function listMeetSessions(userId: number) {
  try {
    return await db
      .select()
      .from(meetSessions)
      .where(eq(meetSessions.userId, userId))
      .orderBy(desc(meetSessions.createdAt));
  } catch (error) {
    console.error('Database query failed (listMeetSessions):', error);
    throw new Error('Failed to load Meet sessions.', { cause: error });
  }
}

export async function createMeetSession(input: {
  userId: number;
  title: string;
  meetingUri: string;
  meetingCode?: string;
  spaceName?: string;
  status?: string;
  scheduledFor?: Date | null;
  notes?: string;
}) {
  try {
    const inserted = await db
      .insert(meetSessions)
      .values({
        userId: input.userId,
        title: input.title,
        meetingUri: input.meetingUri,
        meetingCode: input.meetingCode ?? '',
        spaceName: input.spaceName ?? '',
        status: input.status ?? 'active',
        scheduledFor: input.scheduledFor ?? null,
        notes: input.notes ?? '',
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createMeetSession):', error);
    throw new Error('Failed to create Meet session.', { cause: error });
  }
}

export async function deleteMeetSessionById(id: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(meetSessions.id, id)
      : and(eq(meetSessions.id, id), eq(meetSessions.userId, userId));
    const deleted = await db.delete(meetSessions).where(condition).returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteMeetSessionById):', error);
    throw new Error('Failed to remove Meet session.', { cause: error });
  }
}

// ---- Map Locations ----
export async function listMapLocations(userId: number) {
  try {
    return await db
      .select()
      .from(mapLocations)
      .where(or(eq(mapLocations.userId, userId), eq(mapLocations.isShared, true)))
      .orderBy(desc(mapLocations.createdAt));
  } catch (error) {
    console.error('Database query failed (listMapLocations):', error);
    throw new Error('Failed to load map locations.', { cause: error });
  }
}

export async function createMapLocation(input: {
  userId: number;
  placeId?: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category?: string;
  notes?: string;
  isShared?: boolean;
}) {
  try {
    const inserted = await db
      .insert(mapLocations)
      .values({
        userId: input.userId,
        placeId: input.placeId ?? '',
        name: input.name,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        category: input.category ?? 'office',
        notes: input.notes ?? '',
        isShared: input.isShared ?? true,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createMapLocation):', error);
    throw new Error('Failed to save map location.', { cause: error });
  }
}

export async function deleteMapLocationById(id: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(mapLocations.id, id)
      : and(eq(mapLocations.id, id), eq(mapLocations.userId, userId));
    const deleted = await db.delete(mapLocations).where(condition).returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteMapLocationById):', error);
    throw new Error('Failed to delete map location.', { cause: error });
  }
}

// ---- Gemini Threads & Messages ----
export async function listGeminiThreads(userId: number) {
  try {
    return await db
      .select()
      .from(geminiThreads)
      .where(eq(geminiThreads.userId, userId))
      .orderBy(desc(geminiThreads.updatedAt));
  } catch (error) {
    console.error('Database query failed (listGeminiThreads):', error);
    throw new Error('Failed to load Gemini conversations.', { cause: error });
  }
}

export async function getGeminiThreadById(threadId: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(geminiThreads.id, threadId)
      : and(eq(geminiThreads.id, threadId), eq(geminiThreads.userId, userId));
    const rows = await db.select().from(geminiThreads).where(condition).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (getGeminiThreadById):', error);
    throw new Error('Failed to retrieve Gemini conversation.', { cause: error });
  }
}

export async function createGeminiThread(input: {
  userId: number;
  title?: string;
  model?: string;
  groundWithWorkspace?: boolean;
}) {
  try {
    const inserted = await db
      .insert(geminiThreads)
      .values({
        userId: input.userId,
        title: input.title || 'New Gemini Conversation',
        model: input.model || 'gemini-4-hydrogen',
        groundWithWorkspace: input.groundWithWorkspace ?? true,
        updatedAt: new Date(),
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createGeminiThread):', error);
    throw new Error('Failed to create Gemini conversation.', { cause: error });
  }
}

export async function updateGeminiThread(
  threadId: number,
  userId: number,
  updates: { title?: string; model?: string; groundWithWorkspace?: boolean }
) {
  try {
    const updated = await db
      .update(geminiThreads)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(geminiThreads.id, threadId), eq(geminiThreads.userId, userId)))
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Database query failed (updateGeminiThread):', error);
    throw new Error('Failed to update Gemini conversation.', { cause: error });
  }
}

export async function deleteGeminiThreadById(threadId: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(geminiThreads.id, threadId)
      : and(eq(geminiThreads.id, threadId), eq(geminiThreads.userId, userId));
    const deleted = await db.delete(geminiThreads).where(condition).returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteGeminiThreadById):', error);
    throw new Error('Failed to delete Gemini conversation.', { cause: error });
  }
}

export async function listGeminiMessages(threadId: number) {
  try {
    return await db
      .select()
      .from(geminiMessages)
      .where(eq(geminiMessages.threadId, threadId))
      .orderBy(geminiMessages.createdAt)
      .limit(100);
  } catch (error) {
    console.error('Database query failed (listGeminiMessages):', error);
    throw new Error('Failed to load Gemini messages.', { cause: error });
  }
}

export async function createGeminiMessage(input: {
  threadId: number;
  userId: number;
  role: 'user' | 'model';
  content: string;
  contextRefs?: string[];
}) {
  try {
    const inserted = await db
      .insert(geminiMessages)
      .values({
        threadId: input.threadId,
        userId: input.userId,
        role: input.role,
        content: input.content,
        contextRefs: input.contextRefs ?? [],
      })
      .returning();

    await db
      .update(geminiThreads)
      .set({ updatedAt: new Date() })
      .where(eq(geminiThreads.id, input.threadId));

    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createGeminiMessage):', error);
    throw new Error('Failed to save Gemini message.', { cause: error });
  }
}

// ---- Google Classroom Courses & Items ----
export async function listClassroomCourses(userId: number, includeAllForAdmin = false) {
  try {
    if (includeAllForAdmin) {
      return await db.select().from(classroomCourses).orderBy(desc(classroomCourses.updatedAt));
    }
    return await db
      .select()
      .from(classroomCourses)
      .where(eq(classroomCourses.userId, userId))
      .orderBy(desc(classroomCourses.updatedAt));
  } catch (error) {
    console.error('Database query failed (listClassroomCourses):', error);
    throw new Error('Failed to load Classroom courses.', { cause: error });
  }
}

export async function getClassroomCourseById(id: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(classroomCourses.id, id)
      : and(eq(classroomCourses.id, id), eq(classroomCourses.userId, userId));
    const rows = await db.select().from(classroomCourses).where(condition).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (getClassroomCourseById):', error);
    throw new Error('Failed to retrieve Classroom course.', { cause: error });
  }
}

export async function upsertClassroomCourse(input: {
  userId: number;
  externalId: string;
  name: string;
  section?: string;
  descriptionHeading?: string;
  room?: string;
  courseState?: string;
  alternateLink?: string;
  enrollmentCode?: string;
}) {
  try {
    const result = await db
      .insert(classroomCourses)
      .values({
        userId: input.userId,
        externalId: input.externalId,
        name: input.name,
        section: input.section ?? '',
        descriptionHeading: input.descriptionHeading ?? '',
        room: input.room ?? '',
        courseState: input.courseState ?? 'ACTIVE',
        alternateLink: input.alternateLink ?? '',
        enrollmentCode: input.enrollmentCode ?? '',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [classroomCourses.userId, classroomCourses.externalId],
        set: {
          name: input.name,
          section: input.section ?? '',
          descriptionHeading: input.descriptionHeading ?? '',
          room: input.room ?? '',
          courseState: input.courseState ?? 'ACTIVE',
          alternateLink: input.alternateLink ?? '',
          enrollmentCode: input.enrollmentCode ?? '',
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query failed (upsertClassroomCourse):', error);
    throw new Error('Failed to save Classroom course.', { cause: error });
  }
}

export async function deleteClassroomCourseById(id: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(classroomCourses.id, id)
      : and(eq(classroomCourses.id, id), eq(classroomCourses.userId, userId));
    const deleted = await db.delete(classroomCourses).where(condition).returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteClassroomCourseById):', error);
    throw new Error('Failed to delete Classroom course.', { cause: error });
  }
}

export async function listClassroomItems(courseId: number) {
  try {
    return await db
      .select()
      .from(classroomItems)
      .where(eq(classroomItems.courseId, courseId))
      .orderBy(desc(classroomItems.updatedAt));
  } catch (error) {
    console.error('Database query failed (listClassroomItems):', error);
    throw new Error('Failed to load Classroom items.', { cause: error });
  }
}

export async function upsertClassroomItem(input: {
  courseId: number;
  userId: number;
  itemType: 'coursework' | 'announcement' | 'material';
  externalId: string;
  title: string;
  description?: string;
  state?: string;
  dueDate?: string;
  alternateLink?: string;
  materials?: ClassroomMaterialLink[];
}) {
  try {
    const result = await db
      .insert(classroomItems)
      .values({
        courseId: input.courseId,
        userId: input.userId,
        itemType: input.itemType,
        externalId: input.externalId,
        title: input.title,
        description: input.description ?? '',
        state: input.state ?? 'PUBLISHED',
        dueDate: input.dueDate ?? '',
        alternateLink: input.alternateLink ?? '',
        materials: input.materials ?? [],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [classroomItems.userId, classroomItems.itemType, classroomItems.externalId],
        set: {
          title: input.title,
          description: input.description ?? '',
          state: input.state ?? 'PUBLISHED',
          dueDate: input.dueDate ?? '',
          alternateLink: input.alternateLink ?? '',
          materials: input.materials ?? [],
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query failed (upsertClassroomItem):', error);
    throw new Error('Failed to save Classroom item.', { cause: error });
  }
}

export async function deleteClassroomItemById(id: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(classroomItems.id, id)
      : and(eq(classroomItems.id, id), eq(classroomItems.userId, userId));
    const deleted = await db.delete(classroomItems).where(condition).returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteClassroomItemById):', error);
    throw new Error('Failed to delete Classroom item.', { cause: error });
  }
}

// ---- Google Contacts (People API) ----
export async function listContacts(userId: number, includeAllForAdmin = false) {
  try {
    if (includeAllForAdmin) {
      return await db.select().from(contacts).orderBy(desc(contacts.updatedAt));
    }
    return await db
      .select()
      .from(contacts)
      .where(or(eq(contacts.userId, userId), eq(contacts.isShared, true)))
      .orderBy(desc(contacts.updatedAt));
  } catch (error) {
    console.error('Database query failed (listContacts):', error);
    throw new Error('Failed to load contacts.', { cause: error });
  }
}

export async function upsertContact(input: {
  userId: number;
  externalId: string;
  displayName: string;
  email?: string;
  phone?: string;
  organization?: string;
  jobTitle?: string;
  address?: string;
  photoUrl?: string;
  source?: string;
  notes?: string;
  isShared?: boolean;
}) {
  try {
    const result = await db
      .insert(contacts)
      .values({
        userId: input.userId,
        externalId: input.externalId,
        displayName: input.displayName,
        email: input.email ?? '',
        phone: input.phone ?? '',
        organization: input.organization ?? '',
        jobTitle: input.jobTitle ?? '',
        address: input.address ?? '',
        photoUrl: input.photoUrl ?? '',
        source: input.source ?? 'contacts',
        notes: input.notes ?? '',
        isShared: input.isShared ?? false,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [contacts.userId, contacts.externalId],
        set: {
          displayName: input.displayName,
          email: input.email ?? '',
          phone: input.phone ?? '',
          organization: input.organization ?? '',
          jobTitle: input.jobTitle ?? '',
          address: input.address ?? '',
          photoUrl: input.photoUrl ?? '',
          source: input.source ?? 'contacts',
          notes: input.notes ?? '',
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query failed (upsertContact):', error);
    throw new Error('Failed to save contact.', { cause: error });
  }
}

export async function deleteContactById(id: number, userId: number, isAdmin: boolean) {
  try {
    const condition = isAdmin
      ? eq(contacts.id, id)
      : and(eq(contacts.id, id), eq(contacts.userId, userId));
    const deleted = await db.delete(contacts).where(condition).returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteContactById):', error);
    throw new Error('Failed to delete contact.', { cause: error });
  }
}

// ---- Centralized Platform Summary ----
export async function getCentralizedStats(userId: number, isAdmin: boolean) {
  try {
    const [
      userCount,
      recordCount,
      eventCount,
      mailCount,
      taskCount,
      noteCount,
      chatCount,
      meetCount,
      mapCount,
      geminiCount,
      courseCount,
      contactCount,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      isAdmin
        ? db.select({ count: sql<number>`count(*)::int` }).from(workspaceRecords)
        : db.select({ count: sql<number>`count(*)::int` }).from(workspaceRecords).where(or(eq(workspaceRecords.userId, userId), eq(workspaceRecords.isShared, true))),
      isAdmin
        ? db.select({ count: sql<number>`count(*)::int` }).from(calendarEvents)
        : db.select({ count: sql<number>`count(*)::int` }).from(calendarEvents).where(eq(calendarEvents.userId, userId)),
      isAdmin
        ? db.select({ count: sql<number>`count(*)::int` }).from(mailMessages)
        : db.select({ count: sql<number>`count(*)::int` }).from(mailMessages).where(eq(mailMessages.userId, userId)),
      isAdmin
        ? db.select({ count: sql<number>`count(*)::int` }).from(tasks)
        : db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.userId, userId)),
      isAdmin
        ? db.select({ count: sql<number>`count(*)::int` }).from(notes)
        : db.select({ count: sql<number>`count(*)::int` }).from(notes).where(or(eq(notes.userId, userId), eq(notes.isShared, true))),
      db.select({ count: sql<number>`count(*)::int` }).from(chatMessages),
      isAdmin
        ? db.select({ count: sql<number>`count(*)::int` }).from(meetSessions)
        : db.select({ count: sql<number>`count(*)::int` }).from(meetSessions).where(eq(meetSessions.userId, userId)),
      isAdmin
        ? db.select({ count: sql<number>`count(*)::int` }).from(mapLocations)
        : db.select({ count: sql<number>`count(*)::int` }).from(mapLocations).where(or(eq(mapLocations.userId, userId), eq(mapLocations.isShared, true))),
      isAdmin
        ? db.select({ count: sql<number>`count(*)::int` }).from(geminiThreads)
        : db.select({ count: sql<number>`count(*)::int` }).from(geminiThreads).where(eq(geminiThreads.userId, userId)),
      isAdmin
        ? db.select({ count: sql<number>`count(*)::int` }).from(classroomCourses)
        : db.select({ count: sql<number>`count(*)::int` }).from(classroomCourses).where(eq(classroomCourses.userId, userId)),
      isAdmin
        ? db.select({ count: sql<number>`count(*)::int` }).from(contacts)
        : db.select({ count: sql<number>`count(*)::int` }).from(contacts).where(or(eq(contacts.userId, userId), eq(contacts.isShared, true))),
    ]);

    return {
      users: userCount[0]?.count ?? 0,
      workspaceRecords: recordCount[0]?.count ?? 0,
      calendarEvents: eventCount[0]?.count ?? 0,
      mailMessages: mailCount[0]?.count ?? 0,
      tasks: taskCount[0]?.count ?? 0,
      notes: noteCount[0]?.count ?? 0,
      chatMessages: chatCount[0]?.count ?? 0,
      meetSessions: meetCount[0]?.count ?? 0,
      mapLocations: mapCount[0]?.count ?? 0,
      geminiThreads: geminiCount[0]?.count ?? 0,
      classroomCourses: courseCount[0]?.count ?? 0,
      contacts: contactCount[0]?.count ?? 0,
    };
  } catch (error) {
    console.error('Database query failed (getCentralizedStats):', error);
    throw new Error('Failed to load centralized platform metrics.', { cause: error });
  }
}
