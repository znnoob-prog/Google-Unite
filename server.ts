import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { adminAuth } from './src/lib/firebase-admin.ts';
import { requireAuth, AuthRequest } from './src/middleware/auth.ts';
import {
  getAllUsers,
  getOrCreateUser,
  getRecentAuditLogs,
  recordAuditLog,
  updateUserRole,
  updateUserSyncStatus,
} from './src/db/users.ts';
import {
  createChatMessage,
  createChatSpace,
  createGeminiMessage,
  createGeminiThread,
  createMapLocation,
  createMeetSession,
  createNote,
  deleteCalendarEventById,
  deleteClassroomCourseById,
  deleteClassroomItemById,
  deleteContactById,
  deleteGeminiThreadById,
  deleteMailMessageById,
  deleteMapLocationById,
  deleteMeetSessionById,
  deleteNoteById,
  deleteTaskById,
  deleteWorkspaceRecordById,
  getCentralizedStats,
  getClassroomCourseById,
  getGeminiThreadById,
  listCalendarEvents,
  listChatMessages,
  listChatSpaces,
  listClassroomCourses,
  listClassroomItems,
  listContacts,
  listGeminiMessages,
  listGeminiThreads,
  listMailMessages,
  listMapLocations,
  listMeetSessions,
  listNotes,
  listTasks,
  listWorkspaceRecords,
  markMailReadStatus,
  updateGeminiThread,
  updateNoteById,
  updateTaskById,
  updateWorkspaceRecordById,
  upsertCalendarEvent,
  upsertClassroomCourse,
  upsertClassroomItem,
  upsertContact,
  upsertMailMessage,
  upsertTask,
  upsertWorkspaceRecord,
} from './src/db/queries.ts';
import {
  buildWorkspaceContext,
  extractStructuredWorkspaceActions,
  formatGeminiError,
  normalizeGeminiModel,
  streamWorkspaceGeminiReply,
} from './src/lib/gemini.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '4mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface AuthenticatedSocket {
  ws: WebSocket;
  uid: string;
  userId: number;
  email: string;
  displayName: string;
  role: string;
}

const clients: Set<AuthenticatedSocket> = new Set();

function broadcastPresence() {
  const uniqueUsers = new Map<string, { uid: string; email: string; displayName: string; role: string }>();
  for (const client of clients) {
    uniqueUsers.set(client.uid, {
      uid: client.uid,
      email: client.email,
      displayName: client.displayName,
      role: client.role,
    });
  }
  const message = JSON.stringify({
    type: 'presence:update',
    onlineUsers: Array.from(uniqueUsers.values()),
  });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

function broadcastSync(eventType: string, payload: unknown, scope: 'global' | { uid: string }) {
  const message = JSON.stringify({ type: eventType, payload, timestamp: Date.now() });
  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (scope === 'global' || client.uid === scope.uid || client.role === 'admin') {
      client.ws.send(message);
    }
  }
}

wss.on('connection', (ws) => {
  let authedClient: AuthenticatedSocket | null = null;

  const authTimeout = setTimeout(() => {
    if (!authedClient && ws.readyState === WebSocket.OPEN) {
      ws.close(4001, 'Authentication timeout');
    }
  }, 15000);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.type === 'auth' && typeof msg.token === 'string') {
        const decoded = await adminAuth.verifyIdToken(msg.token);
        const email = decoded.email || `${decoded.uid}@firebase.local`;
        const dbUser = await getOrCreateUser(decoded.uid, email, decoded.name, decoded.picture);
        authedClient = {
          ws,
          uid: decoded.uid,
          userId: dbUser.id,
          email: dbUser.email,
          displayName: dbUser.displayName,
          role: dbUser.role,
        };
        clients.add(authedClient);
        clearTimeout(authTimeout);
        ws.send(JSON.stringify({ type: 'auth:ok', userId: dbUser.id, role: dbUser.role }));
        broadcastPresence();
      } else if (msg?.type === 'ping' && authedClient) {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
      if (!authedClient) {
        ws.close(4003, 'Invalid authentication token');
      }
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    if (authedClient) {
      clients.delete(authedClient);
      broadcastPresence();
    }
  });
});

// ---- Public Configuration & Health ----
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/public-config', (_req, res) => {
  const mapsApiKey =
    process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
  res.json({ mapsApiKey });
});

// ---- Authenticated User & Centralized Overview ----
app.get('/api/me', requireAuth, async (req: AuthRequest, res) => {
  res.json({ user: req.dbUser });
});

app.get('/api/overview', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const isAdmin = dbUser.role === 'admin';
    const [stats, records, events, mails, taskList, noteList, locations, meets, courses, contactList] =
      await Promise.all([
        getCentralizedStats(dbUser.id, isAdmin),
        listWorkspaceRecords(dbUser.id, undefined, isAdmin),
        listCalendarEvents(dbUser.id),
        listMailMessages(dbUser.id),
        listTasks(dbUser.id),
        listNotes(dbUser.id),
        listMapLocations(dbUser.id),
        listMeetSessions(dbUser.id),
        listClassroomCourses(dbUser.id, isAdmin),
        listContacts(dbUser.id, isAdmin),
      ]);

    res.json({
      stats,
      recentRecords: records.slice(0, 12),
      upcomingEvents: events.slice(0, 8),
      recentMails: mails.slice(0, 8),
      pendingTasks: taskList.slice(0, 10),
      pinnedNotes: noteList.slice(0, 8),
      mapLocations: locations.slice(0, 10),
      meetSessions: meets.slice(0, 6),
      classroomCourses: courses.slice(0, 6),
      contacts: contactList.slice(0, 6),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load workspace overview' });
  }
});

// ---- Centralized Admin & Sync Status ----
app.get('/api/admin/users', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    if (dbUser.role === 'admin') {
      const allUsers = await getAllUsers();
      res.json({ users: allUsers, isAdmin: true });
    } else {
      res.json({ users: [dbUser], isAdmin: false });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load user accounts' });
  }
});

app.patch('/api/admin/users/:id/role', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    if (dbUser.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: Administrator access required' });
      return;
    }
    const targetId = Number(req.params.id);
    const role = req.body?.role;
    if (!Number.isInteger(targetId) || (role !== 'admin' && role !== 'member')) {
      res.status(400).json({ error: 'Invalid user ID or role' });
      return;
    }
    if (targetId === dbUser.id && role !== 'admin') {
      res.status(400).json({ error: 'You cannot revoke your own administrator role.' });
      return;
    }
    const updated = await updateUserRole(targetId, role);
    if (!updated) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    await recordAuditLog(dbUser.id, dbUser.email, 'role:updated', 'admin', `Updated ${updated.email} to ${role}`);
    broadcastSync('admin:users_updated', { userId: updated.id, role }, 'global');
    res.json({ user: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update role' });
  }
});

app.get('/api/admin/logs', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const logs = await getRecentAuditLogs(dbUser.id, dbUser.role === 'admin');
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load audit logs' });
  }
});

app.post('/api/sync/status', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const services = Array.isArray(req.body?.services)
      ? req.body.services.filter((s: unknown) => typeof s === 'string').slice(0, 20)
      : [];
    const updated = await updateUserSyncStatus(dbUser.id, services);
    await recordAuditLog(
      dbUser.id,
      dbUser.email,
      'workspace:synced',
      'sync',
      `Synchronized services: ${services.join(', ') || 'SQL workspace'}`
    );
    broadcastSync('sync:completed', { uid: dbUser.uid, services }, 'global');
    res.json({ user: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to record sync status' });
  }
});

// ---- Workspace Records (Drive, Docs, Sheets, Slides, Forms) ----
app.get('/api/records', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const service = typeof req.query.service === 'string' ? req.query.service : undefined;
    const records = await listWorkspaceRecords(dbUser.id, service, dbUser.role === 'admin');
    res.json({ records });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list workspace records' });
  }
});

app.post('/api/records', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const items = Array.isArray(req.body?.records) ? req.body.records : [req.body];
    const saved = [];
    for (const item of items) {
      if (!item || typeof item.service !== 'string' || typeof item.title !== 'string') {
        continue;
      }
      const record = await upsertWorkspaceRecord({
        userId: dbUser.id,
        service: item.service,
        externalId:
          typeof item.externalId === 'string' && item.externalId.trim()
            ? item.externalId.trim()
            : `local-${item.service}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: item.title.trim().slice(0, 300),
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : '',
        summary: typeof item.summary === 'string' ? item.summary.slice(0, 2000) : '',
        webViewLink:
          typeof item.webViewLink === 'string' && item.webViewLink.startsWith('https://')
            ? item.webViewLink
            : '',
        payload: item.payload && typeof item.payload === 'object' ? item.payload : {},
        isStarred: Boolean(item.isStarred),
        isShared: Boolean(item.isShared),
      });
      saved.push(record);
    }

    if (saved.length > 0) {
      await recordAuditLog(
        dbUser.id,
        dbUser.email,
        'records:upserted',
        saved[0].service,
        `Saved ${saved.length} record(s)`
      );
      broadcastSync('records:updated', { count: saved.length }, { uid: dbUser.uid });
    }
    res.json({ records: saved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save workspace records' });
  }
});

app.patch('/api/records/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid record ID' });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (typeof req.body?.title === 'string') updates.title = req.body.title.trim().slice(0, 300);
    if (typeof req.body?.summary === 'string') updates.summary = req.body.summary.slice(0, 2000);
    if (req.body?.payload && typeof req.body.payload === 'object') updates.payload = req.body.payload;
    if (typeof req.body?.isStarred === 'boolean') updates.isStarred = req.body.isStarred;
    if (typeof req.body?.isShared === 'boolean') updates.isShared = req.body.isShared;

    const updated = await updateWorkspaceRecordById(
      id,
      dbUser.id,
      dbUser.role === 'admin',
      updates
    );
    if (!updated) {
      res.status(404).json({ error: 'Record not found or access denied' });
      return;
    }
    broadcastSync('records:updated', { id: updated.id }, updated.isShared ? 'global' : { uid: dbUser.uid });
    res.json({ record: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update record' });
  }
});

app.delete('/api/records/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid record ID' });
      return;
    }
    const deleted = await deleteWorkspaceRecordById(id, dbUser.id, dbUser.role === 'admin');
    if (!deleted) {
      res.status(404).json({ error: 'Record not found or access denied' });
      return;
    }
    await recordAuditLog(dbUser.id, dbUser.email, 'record:deleted', deleted.service, deleted.title);
    broadcastSync('records:updated', { deletedId: id }, { uid: dbUser.uid });
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete record' });
  }
});

// ---- Calendar Events ----
app.get('/api/calendar', requireAuth, async (req: AuthRequest, res) => {
  try {
    const events = await listCalendarEvents(req.dbUser!.id);
    res.json({ events });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list calendar events' });
  }
});

app.post('/api/calendar', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const items = Array.isArray(req.body?.events) ? req.body.events : [req.body];
    const saved = [];
    for (const item of items) {
      if (!item || typeof item.title !== 'string') continue;
      const start = item.startTime ? new Date(item.startTime) : new Date();
      const end = item.endTime ? new Date(item.endTime) : new Date(start.getTime() + 3600000);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
      const ev = await upsertCalendarEvent({
        userId: dbUser.id,
        externalId:
          typeof item.externalId === 'string' && item.externalId.trim()
            ? item.externalId.trim()
            : `local-cal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: item.title.trim().slice(0, 250),
        description: typeof item.description === 'string' ? item.description.slice(0, 2000) : '',
        location: typeof item.location === 'string' ? item.location.slice(0, 300) : '',
        startTime: start,
        endTime: end,
        meetLink:
          typeof item.meetLink === 'string' && item.meetLink.startsWith('https://')
            ? item.meetLink
            : '',
        status: typeof item.status === 'string' ? item.status : 'confirmed',
      });
      saved.push(ev);
    }
    if (saved.length > 0) {
      await recordAuditLog(dbUser.id, dbUser.email, 'calendar:synced', 'calendar', `Saved ${saved.length} event(s)`);
      broadcastSync('calendar:updated', { count: saved.length }, { uid: dbUser.uid });
    }
    res.json({ events: saved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save calendar events' });
  }
});

app.delete('/api/calendar/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid event ID' });
      return;
    }
    const deleted = await deleteCalendarEventById(id, dbUser.id, dbUser.role === 'admin');
    if (!deleted) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    broadcastSync('calendar:updated', { deletedId: id }, { uid: dbUser.uid });
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete event' });
  }
});

// ---- Gmail Messages ----
app.get('/api/mail', requireAuth, async (req: AuthRequest, res) => {
  try {
    const messages = await listMailMessages(req.dbUser!.id);
    res.json({ messages });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list messages' });
  }
});

app.post('/api/mail', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const items = Array.isArray(req.body?.messages) ? req.body.messages : [req.body];
    const saved = [];
    for (const item of items) {
      if (!item || typeof item.subject !== 'string' || typeof item.fromEmail !== 'string') continue;
      const mail = await upsertMailMessage({
        userId: dbUser.id,
        externalId:
          typeof item.externalId === 'string' && item.externalId.trim()
            ? item.externalId.trim()
            : `local-mail-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        threadId: typeof item.threadId === 'string' ? item.threadId : '',
        fromEmail: item.fromEmail.slice(0, 200),
        toEmail: typeof item.toEmail === 'string' ? item.toEmail.slice(0, 200) : '',
        subject: item.subject.slice(0, 300),
        snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, 500) : '',
        body: typeof item.body === 'string' ? item.body.slice(0, 20000) : '',
        labels: Array.isArray(item.labels) ? item.labels.filter((l: unknown) => typeof l === 'string') : [],
        isUnread: typeof item.isUnread === 'boolean' ? item.isUnread : true,
        receivedAt: item.receivedAt ? new Date(item.receivedAt) : new Date(),
      });
      saved.push(mail);
    }
    if (saved.length > 0) {
      await recordAuditLog(dbUser.id, dbUser.email, 'mail:synced', 'gmail', `Synced ${saved.length} message(s)`);
      broadcastSync('mail:updated', { count: saved.length }, { uid: dbUser.uid });
    }
    res.json({ messages: saved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save messages' });
  }
});

app.patch('/api/mail/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || typeof req.body?.isUnread !== 'boolean') {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const updated = await markMailReadStatus(id, dbUser.id, req.body.isUnread);
    if (!updated) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    broadcastSync('mail:updated', { id }, { uid: dbUser.uid });
    res.json({ message: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update message' });
  }
});

app.delete('/api/mail/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid message ID' });
      return;
    }
    const deleted = await deleteMailMessageById(id, dbUser.id);
    if (!deleted) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    broadcastSync('mail:updated', { deletedId: id }, { uid: dbUser.uid });
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete message' });
  }
});

// ---- Tasks ----
app.get('/api/tasks', requireAuth, async (req: AuthRequest, res) => {
  try {
    const taskList = await listTasks(req.dbUser!.id);
    res.json({ tasks: taskList });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list tasks' });
  }
});

app.post('/api/tasks', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const items = Array.isArray(req.body?.tasks) ? req.body.tasks : [req.body];
    const saved = [];
    for (const item of items) {
      if (!item || typeof item.title !== 'string' || !item.title.trim()) continue;
      const task = await upsertTask({
        userId: dbUser.id,
        externalId:
          typeof item.externalId === 'string' && item.externalId.trim()
            ? item.externalId.trim()
            : `local-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        listId: typeof item.listId === 'string' ? item.listId : '@default',
        listTitle: typeof item.listTitle === 'string' ? item.listTitle : 'My Tasks',
        title: item.title.trim().slice(0, 250),
        notes: typeof item.notes === 'string' ? item.notes.slice(0, 2000) : '',
        dueDate: typeof item.dueDate === 'string' ? item.dueDate : '',
        status: item.status === 'completed' ? 'completed' : 'needsAction',
        priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
      });
      saved.push(task);
    }
    if (saved.length > 0) {
      await recordAuditLog(dbUser.id, dbUser.email, 'tasks:updated', 'tasks', `Saved ${saved.length} task(s)`);
      broadcastSync('tasks:updated', { count: saved.length }, { uid: dbUser.uid });
    }
    res.json({ tasks: saved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save tasks' });
  }
});

app.patch('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid task ID' });
      return;
    }
    const updates: Record<string, string> = {};
    if (typeof req.body?.title === 'string') updates.title = req.body.title.trim().slice(0, 250);
    if (typeof req.body?.notes === 'string') updates.notes = req.body.notes.slice(0, 2000);
    if (req.body?.status === 'completed' || req.body?.status === 'needsAction') updates.status = req.body.status;
    if (['high', 'medium', 'low'].includes(req.body?.priority)) updates.priority = req.body.priority;
    if (typeof req.body?.dueDate === 'string') updates.dueDate = req.body.dueDate;

    const updated = await updateTaskById(id, dbUser.id, updates);
    if (!updated) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    broadcastSync('tasks:updated', { id }, { uid: dbUser.uid });
    res.json({ task: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update task' });
  }
});

app.delete('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid task ID' });
      return;
    }
    const deleted = await deleteTaskById(id, dbUser.id);
    if (!deleted) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    broadcastSync('tasks:updated', { deletedId: id }, { uid: dbUser.uid });
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete task' });
  }
});

// ---- Notes (Google Keep Hub) ----
app.get('/api/notes', requireAuth, async (req: AuthRequest, res) => {
  try {
    const noteList = await listNotes(req.dbUser!.id);
    res.json({ notes: noteList });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load notes' });
  }
});

app.post('/api/notes', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const items = Array.isArray(req.body?.notes) ? req.body.notes : [req.body];
    const saved = [];
    for (const item of items) {
      if (!item) continue;
      const externalId = typeof item.externalId === 'string' ? item.externalId.trim().slice(0, 200) : '';
      const title = typeof item.title === 'string' ? item.title.trim().slice(0, 200) : '';
      const content = typeof item.content === 'string' ? item.content.slice(0, 5000) : '';
      const checklist = Array.isArray(item.checklist) ? item.checklist.slice(0, 50) : [];
      const color = typeof item.color === 'string' ? item.color : 'slate';
      const isPinned = Boolean(item.isPinned);
      const isShared = Boolean(item.isShared);
      if (!title && !content && checklist.length === 0) continue;

      const note = await createNote({
        userId: dbUser.id,
        externalId,
        title,
        content,
        checklist,
        color,
        isPinned,
        isShared,
      });
      saved.push(note);
    }

    if (saved.length === 0) {
      res.status(400).json({ error: 'Note must have a title, content, or checklist items.' });
      return;
    }

    await recordAuditLog(
      dbUser.id,
      dbUser.email,
      'note:saved',
      'keep',
      saved.length === 1 ? saved[0].title || 'Untitled Note' : `Saved ${saved.length} notes`
    );
    broadcastSync(
      'notes:updated',
      { count: saved.length },
      saved.some((n) => n.isShared) ? 'global' : { uid: dbUser.uid }
    );
    res.json({ note: saved[0], notes: saved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create note' });
  }
});

app.patch('/api/notes/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid note ID' });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (typeof req.body?.title === 'string') updates.title = req.body.title.trim().slice(0, 200);
    if (typeof req.body?.content === 'string') updates.content = req.body.content.slice(0, 5000);
    if (Array.isArray(req.body?.checklist)) updates.checklist = req.body.checklist.slice(0, 50);
    if (typeof req.body?.color === 'string') updates.color = req.body.color;
    if (typeof req.body?.isPinned === 'boolean') updates.isPinned = req.body.isPinned;
    if (typeof req.body?.isShared === 'boolean') updates.isShared = req.body.isShared;

    const updated = await updateNoteById(id, dbUser.id, dbUser.role === 'admin', updates);
    if (!updated) {
      res.status(404).json({ error: 'Note not found or access denied' });
      return;
    }
    broadcastSync('notes:updated', { id }, updated.isShared ? 'global' : { uid: dbUser.uid });
    res.json({ note: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update note' });
  }
});

app.delete('/api/notes/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid note ID' });
      return;
    }
    const deleted = await deleteNoteById(id, dbUser.id, dbUser.role === 'admin');
    if (!deleted) {
      res.status(404).json({ error: 'Note not found or access denied' });
      return;
    }
    broadcastSync('notes:updated', { deletedId: id }, 'global');
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete note' });
  }
});

// ---- Chat Spaces & Real-Time Messages ----
app.get('/api/chat/spaces', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const spaces = await listChatSpaces();
    res.json({ spaces });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list chat spaces' });
  }
});

app.post('/api/chat/spaces', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    if (!name) {
      res.status(400).json({ error: 'Space name is required' });
      return;
    }
    const slug =
      (typeof req.body?.slug === 'string' && req.body.slug.trim()) ||
      name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
      `space-${Date.now()}`;

    const space = await createChatSpace({
      slug,
      name,
      description: typeof req.body?.description === 'string' ? req.body.description.slice(0, 300) : '',
      externalSpaceName: typeof req.body?.externalSpaceName === 'string' ? req.body.externalSpaceName : '',
      createdByUserId: dbUser.id,
    });
    await recordAuditLog(dbUser.id, dbUser.email, 'chat:space_created', 'chat', name);
    broadcastSync('chat:spaces_updated', { space }, 'global');
    res.json({ space });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create chat space' });
  }
});

app.get('/api/chat/spaces/:spaceId/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const spaceId = Number(req.params.spaceId);
    if (!Number.isInteger(spaceId)) {
      res.status(400).json({ error: 'Invalid space ID' });
      return;
    }
    const messages = await listChatMessages(spaceId);
    res.json({ messages });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list chat messages' });
  }
});

app.post('/api/chat/spaces/:spaceId/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const spaceId = Number(req.params.spaceId);
    const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 4000) : '';
    if (!Number.isInteger(spaceId) || !content) {
      res.status(400).json({ error: 'Space ID and non-empty message content are required' });
      return;
    }
    const message = await createChatMessage({
      spaceId,
      userId: dbUser.id,
      senderName: dbUser.displayName || dbUser.email,
      senderEmail: dbUser.email,
      content,
      externalMessageName: typeof req.body?.externalMessageName === 'string' ? req.body.externalMessageName : '',
    });
    broadcastSync('chat:message_created', { spaceId, message }, 'global');
    res.json({ message });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to send message' });
  }
});

// ---- Meet Sessions ----
app.get('/api/meet', requireAuth, async (req: AuthRequest, res) => {
  try {
    const sessions = await listMeetSessions(req.dbUser!.id);
    res.json({ sessions });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list Meet sessions' });
  }
});

app.post('/api/meet', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 200) : 'Instant Sync';
    const meetingUri = typeof req.body?.meetingUri === 'string' ? req.body.meetingUri.trim() : '';
    if (!meetingUri || !meetingUri.startsWith('https://')) {
      res.status(400).json({ error: 'Valid HTTPS meeting URI is required' });
      return;
    }
    const session = await createMeetSession({
      userId: dbUser.id,
      title,
      meetingUri,
      meetingCode: typeof req.body?.meetingCode === 'string' ? req.body.meetingCode : '',
      spaceName: typeof req.body?.spaceName === 'string' ? req.body.spaceName : '',
      status: typeof req.body?.status === 'string' ? req.body.status : 'active',
      scheduledFor: req.body?.scheduledFor ? new Date(req.body.scheduledFor) : null,
      notes: typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 2000) : '',
    });
    await recordAuditLog(dbUser.id, dbUser.email, 'meet:created', 'meet', title);
    broadcastSync('meet:updated', { session }, { uid: dbUser.uid });
    res.json({ session });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save Meet session' });
  }
});

app.delete('/api/meet/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }
    const deleted = await deleteMeetSessionById(id, dbUser.id, dbUser.role === 'admin');
    if (!deleted) {
      res.status(404).json({ error: 'Meet session not found' });
      return;
    }
    broadcastSync('meet:updated', { deletedId: id }, { uid: dbUser.uid });
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete Meet session' });
  }
});

// ---- Map Locations ----
app.get('/api/maps/locations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const locations = await listMapLocations(req.dbUser!.id);
    res.json({ locations });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list map locations' });
  }
});

app.post('/api/maps/locations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 200) : '';
    const address = typeof req.body?.address === 'string' ? req.body.address.trim().slice(0, 400) : '';
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);

    if (!name || !address || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: 'Valid name, address, latitude, and longitude are required' });
      return;
    }

    const location = await createMapLocation({
      userId: dbUser.id,
      placeId: typeof req.body?.placeId === 'string' ? req.body.placeId : '',
      name,
      address,
      lat,
      lng,
      category: ['office', 'client', 'meeting', 'logistics'].includes(req.body?.category)
        ? req.body.category
        : 'office',
      notes: typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 1000) : '',
      isShared: typeof req.body?.isShared === 'boolean' ? req.body.isShared : true,
    });
    await recordAuditLog(dbUser.id, dbUser.email, 'maps:location_saved', 'maps', name);
    broadcastSync('maps:updated', { location }, location.isShared ? 'global' : { uid: dbUser.uid });
    res.json({ location });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save location' });
  }
});

app.delete('/api/maps/locations/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid location ID' });
      return;
    }
    const deleted = await deleteMapLocationById(id, dbUser.id, dbUser.role === 'admin');
    if (!deleted) {
      res.status(404).json({ error: 'Location not found or access denied' });
      return;
    }
    broadcastSync('maps:updated', { deletedId: id }, 'global');
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete location' });
  }
});

// ---- Google Gemini AI Workspace ----
app.get('/api/gemini/threads', requireAuth, async (req: AuthRequest, res) => {
  try {
    const threads = await listGeminiThreads(req.dbUser!.id);
    res.json({ threads });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list Gemini conversations' });
  }
});

app.post('/api/gemini/threads', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const title =
      typeof req.body?.title === 'string' && req.body.title.trim()
        ? req.body.title.trim().slice(0, 120)
        : 'New Gemini Conversation';
    const model = normalizeGeminiModel(req.body?.model);
    const groundWithWorkspace =
      typeof req.body?.groundWithWorkspace === 'boolean' ? req.body.groundWithWorkspace : true;

    const thread = await createGeminiThread({
      userId: dbUser.id,
      title,
      model,
      groundWithWorkspace,
    });
    broadcastSync('gemini:updated', { threadId: thread.id }, { uid: dbUser.uid });
    res.json({ thread });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create Gemini conversation' });
  }
});

app.patch('/api/gemini/threads/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const threadId = Number(req.params.id);
    if (!Number.isInteger(threadId)) {
      res.status(400).json({ error: 'Invalid conversation ID' });
      return;
    }
    const updates: { title?: string; model?: string; groundWithWorkspace?: boolean } = {};
    if (typeof req.body?.title === 'string' && req.body.title.trim()) {
      updates.title = req.body.title.trim().slice(0, 120);
    }
    if (typeof req.body?.model === 'string') {
      updates.model = normalizeGeminiModel(req.body.model);
    }
    if (typeof req.body?.groundWithWorkspace === 'boolean') {
      updates.groundWithWorkspace = req.body.groundWithWorkspace;
    }

    const updated = await updateGeminiThread(threadId, dbUser.id, updates);
    if (!updated) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    broadcastSync('gemini:updated', { threadId: updated.id }, { uid: dbUser.uid });
    res.json({ thread: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update conversation' });
  }
});

app.delete('/api/gemini/threads/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const threadId = Number(req.params.id);
    if (!Number.isInteger(threadId)) {
      res.status(400).json({ error: 'Invalid conversation ID' });
      return;
    }
    const deleted = await deleteGeminiThreadById(threadId, dbUser.id, dbUser.role === 'admin');
    if (!deleted) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    broadcastSync('gemini:updated', { deletedThreadId: threadId }, { uid: dbUser.uid });
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete conversation' });
  }
});

app.get('/api/gemini/threads/:id/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const threadId = Number(req.params.id);
    if (!Number.isInteger(threadId)) {
      res.status(400).json({ error: 'Invalid conversation ID' });
      return;
    }
    const thread = await getGeminiThreadById(threadId, dbUser.id, dbUser.role === 'admin');
    if (!thread) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const messages = await listGeminiMessages(threadId);
    res.json({ messages });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load messages' });
  }
});

app.post('/api/gemini/threads/:id/messages/stream', requireAuth, async (req: AuthRequest, res) => {
  const dbUser = req.dbUser!;
  const threadId = Number(req.params.id);
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 8000) : '';
  const requestedModel = normalizeGeminiModel(req.body?.model);
  const groundWithWorkspace =
    typeof req.body?.groundWithWorkspace === 'boolean' ? req.body.groundWithWorkspace : true;

  if (!Number.isInteger(threadId) || !prompt) {
    res.status(400).json({ error: 'Valid conversation ID and non-empty prompt are required' });
    return;
  }

  const thread = await getGeminiThreadById(threadId, dbUser.id, false);
  if (!thread) {
    res.status(404).json({ error: 'Conversation not found or access denied' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const existingMessages = await listGeminiMessages(threadId);

    let workspaceContext: string | undefined;
    let contextRefs: string[] = [];
    if (groundWithWorkspace) {
      const ctx = await buildWorkspaceContext(dbUser.id);
      workspaceContext = ctx.contextText;
      contextRefs = ctx.contextRefs;
    }

    // Persist user message immediately
    const userMessage = await createGeminiMessage({
      threadId,
      userId: dbUser.id,
      role: 'user',
      content: prompt,
      contextRefs,
    });

    // Update thread title on first message
    if (existingMessages.length === 0) {
      const autoTitle = prompt.length > 52 ? `${prompt.slice(0, 49)}...` : prompt;
      await updateGeminiThread(threadId, dbUser.id, {
        title: autoTitle,
        model: requestedModel,
        groundWithWorkspace,
      });
    } else {
      await updateGeminiThread(threadId, dbUser.id, {
        model: requestedModel,
        groundWithWorkspace,
      });
    }

    sendEvent({ type: 'user_saved', message: userMessage, contextRefs });

    const history = existingMessages.map((m) => ({
      role: (m.role === 'model' ? 'model' : 'user') as 'user' | 'model',
      content: m.content,
    }));

    const replyText = await streamWorkspaceGeminiReply({
      model: requestedModel,
      history,
      userPrompt: prompt,
      userDisplayName: dbUser.displayName || dbUser.email,
      userEmail: dbUser.email,
      workspaceContext,
      onChunk: (delta) => {
        sendEvent({ type: 'delta', text: delta });
      },
    });

    const modelMessage = await createGeminiMessage({
      threadId,
      userId: dbUser.id,
      role: 'model',
      content: replyText || 'No response text generated.',
      contextRefs,
    });

    await recordAuditLog(
      dbUser.id,
      dbUser.email,
      'gemini:prompted',
      'gemini',
      `${requestedModel} (${contextRefs.length} context sources)`
    );
    broadcastSync('gemini:updated', { threadId }, { uid: dbUser.uid });

    sendEvent({ type: 'done', message: modelMessage });
    res.end();
  } catch (err: unknown) {
    console.error('Gemini streaming error:', err);
    const formatted = formatGeminiError(err);
    sendEvent({ type: 'error', status: formatted.status, error: formatted.message });
    res.end();
  }
});

app.post('/api/gemini/extract-actions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const sourceText =
      typeof req.body?.sourceText === 'string' ? req.body.sourceText.trim().slice(0, 12000) : '';
    const includeWorkspace = Boolean(req.body?.groundWithWorkspace);

    if (!sourceText) {
      res.status(400).json({ error: 'Source text is required to extract workspace actions.' });
      return;
    }

    let workspaceContext: string | undefined;
    if (includeWorkspace) {
      const ctx = await buildWorkspaceContext(dbUser.id);
      workspaceContext = ctx.contextText;
    }

    const plan = await extractStructuredWorkspaceActions({
      sourceText,
      workspaceContext,
    });

    await recordAuditLog(
      dbUser.id,
      dbUser.email,
      'gemini:actions_extracted',
      'gemini',
      `Extracted ${plan.tasks.length} task(s)`
    );
    res.json({ plan });
  } catch (err: unknown) {
    console.error('Gemini action extraction error:', err);
    const formatted = formatGeminiError(err);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// ---- Google Classroom ----
app.get('/api/classroom/courses', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const courses = await listClassroomCourses(dbUser.id, dbUser.role === 'admin');
    res.json({ courses });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to list Classroom courses' });
  }
});

app.post('/api/classroom/courses', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const items = Array.isArray(req.body?.courses) ? req.body.courses : [req.body];
    const saved = [];
    for (const item of items) {
      if (!item || typeof item.name !== 'string' || !item.name.trim()) continue;
      const course = await upsertClassroomCourse({
        userId: dbUser.id,
        externalId:
          typeof item.externalId === 'string' && item.externalId.trim()
            ? item.externalId.trim()
            : `local-course-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: item.name.trim().slice(0, 200),
        section: typeof item.section === 'string' ? item.section.slice(0, 120) : '',
        descriptionHeading:
          typeof item.descriptionHeading === 'string' ? item.descriptionHeading.slice(0, 300) : '',
        room: typeof item.room === 'string' ? item.room.slice(0, 100) : '',
        courseState: typeof item.courseState === 'string' ? item.courseState : 'ACTIVE',
        alternateLink:
          typeof item.alternateLink === 'string' && item.alternateLink.startsWith('https://')
            ? item.alternateLink
            : '',
        enrollmentCode: typeof item.enrollmentCode === 'string' ? item.enrollmentCode.slice(0, 40) : '',
      });
      saved.push(course);
    }
    if (saved.length > 0) {
      await recordAuditLog(dbUser.id, dbUser.email, 'classroom:courses_saved', 'classroom', `Saved ${saved.length} course(s)`);
      broadcastSync('classroom:updated', { count: saved.length }, { uid: dbUser.uid });
    }
    res.json({ courses: saved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save Classroom courses' });
  }
});

app.delete('/api/classroom/courses/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid course ID' });
      return;
    }
    const deleted = await deleteClassroomCourseById(id, dbUser.id, dbUser.role === 'admin');
    if (!deleted) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }
    broadcastSync('classroom:updated', { deletedCourseId: id }, { uid: dbUser.uid });
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete Classroom course' });
  }
});

app.get('/api/classroom/courses/:id/items', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const courseId = Number(req.params.id);
    if (!Number.isInteger(courseId)) {
      res.status(400).json({ error: 'Invalid course ID' });
      return;
    }
    const course = await getClassroomCourseById(courseId, dbUser.id, dbUser.role === 'admin');
    if (!course) {
      res.status(404).json({ error: 'Course not found' });
      return;
    }
    const items = await listClassroomItems(courseId);
    res.json({ items });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load Classroom items' });
  }
});

app.post('/api/classroom/courses/:id/items', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const courseId = Number(req.params.id);
    if (!Number.isInteger(courseId)) {
      res.status(400).json({ error: 'Invalid course ID' });
      return;
    }
    const course = await getClassroomCourseById(courseId, dbUser.id, false);
    if (!course) {
      res.status(404).json({ error: 'Course not found or access denied' });
      return;
    }
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [req.body];
    const saved = [];
    for (const item of rawItems) {
      if (!item || typeof item.title !== 'string' || !item.title.trim()) continue;
      const itemType =
        item.itemType === 'announcement' || item.itemType === 'material' ? item.itemType : 'coursework';
      const created = await upsertClassroomItem({
        courseId,
        userId: dbUser.id,
        itemType,
        externalId:
          typeof item.externalId === 'string' && item.externalId.trim()
            ? item.externalId.trim()
            : `local-${itemType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: item.title.trim().slice(0, 250),
        description: typeof item.description === 'string' ? item.description.slice(0, 4000) : '',
        state: typeof item.state === 'string' ? item.state : 'PUBLISHED',
        dueDate: typeof item.dueDate === 'string' ? item.dueDate : '',
        alternateLink:
          typeof item.alternateLink === 'string' && item.alternateLink.startsWith('https://')
            ? item.alternateLink
            : '',
        materials: Array.isArray(item.materials) ? item.materials.slice(0, 12) : [],
      });
      saved.push(created);
    }
    if (saved.length > 0) {
      broadcastSync('classroom:updated', { courseId }, { uid: dbUser.uid });
    }
    res.json({ items: saved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save Classroom items' });
  }
});

app.delete('/api/classroom/items/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const deleted = await deleteClassroomItemById(id, dbUser.id, dbUser.role === 'admin');
    if (!deleted) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    broadcastSync('classroom:updated', { deletedItemId: id }, { uid: dbUser.uid });
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete Classroom item' });
  }
});

// ---- Google Contacts (People API) ----
app.get('/api/contacts', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const contactList = await listContacts(dbUser.id, dbUser.role === 'admin');
    res.json({ contacts: contactList });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to load contacts' });
  }
});

app.post('/api/contacts', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const items = Array.isArray(req.body?.contacts) ? req.body.contacts : [req.body];
    const saved = [];
    for (const item of items) {
      if (!item || typeof item.displayName !== 'string' || !item.displayName.trim()) continue;
      const c = await upsertContact({
        userId: dbUser.id,
        externalId:
          typeof item.externalId === 'string' && item.externalId.trim()
            ? item.externalId.trim()
            : `local-contact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        displayName: item.displayName.trim().slice(0, 200),
        email: typeof item.email === 'string' ? item.email.trim().slice(0, 200) : '',
        phone: typeof item.phone === 'string' ? item.phone.trim().slice(0, 80) : '',
        organization: typeof item.organization === 'string' ? item.organization.trim().slice(0, 200) : '',
        jobTitle: typeof item.jobTitle === 'string' ? item.jobTitle.trim().slice(0, 120) : '',
        address: typeof item.address === 'string' ? item.address.trim().slice(0, 300) : '',
        photoUrl:
          typeof item.photoUrl === 'string' && item.photoUrl.startsWith('https://')
            ? item.photoUrl
            : '',
        source: ['contacts', 'other', 'directory', 'manual'].includes(item.source)
          ? item.source
          : 'contacts',
        notes: typeof item.notes === 'string' ? item.notes.slice(0, 1000) : '',
        isShared: Boolean(item.isShared),
      });
      saved.push(c);
    }
    if (saved.length > 0) {
      await recordAuditLog(dbUser.id, dbUser.email, 'contacts:synced', 'contacts', `Saved ${saved.length} contact(s)`);
      broadcastSync('contacts:updated', { count: saved.length }, { uid: dbUser.uid });
    }
    res.json({ contacts: saved });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to save contacts' });
  }
});

app.delete('/api/contacts/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid contact ID' });
      return;
    }
    const deleted = await deleteContactById(id, dbUser.id, dbUser.role === 'admin');
    if (!deleted) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    await recordAuditLog(dbUser.id, dbUser.email, 'contact:deleted', 'contacts', deleted.displayName);
    broadcastSync('contacts:updated', { deletedId: id }, { uid: dbUser.uid });
    res.json({ deleted });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete contact' });
  }
});

// ---- Vite Dev Middleware / Production Static Serving ----
async function startServer() {
  const PORT = 3000;
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Google Unite server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
