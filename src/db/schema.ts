import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default(''),
  photoUrl: text('photo_url').notNull().default(''),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  connectedServices: jsonb('connected_services').$type<string[]>().notNull().default([]),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workspaceRecords = pgTable(
  'workspace_records',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    service: text('service').notNull(), // 'drive' | 'docs' | 'sheets' | 'slides' | 'forms'
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    mimeType: text('mime_type').notNull().default(''),
    summary: text('summary').notNull().default(''),
    webViewLink: text('web_view_link').notNull().default(''),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    isStarred: boolean('is_starred').notNull().default(false),
    isShared: boolean('is_shared').notNull().default(false),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('workspace_records_user_service_ext_idx').on(
      table.userId,
      table.service,
      table.externalId
    ),
  ]
);

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    location: text('location').notNull().default(''),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time').notNull(),
    meetLink: text('meet_link').notNull().default(''),
    status: text('status').notNull().default('confirmed'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('calendar_events_user_ext_idx').on(table.userId, table.externalId),
  ]
);

export const mailMessages = pgTable(
  'mail_messages',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    externalId: text('external_id').notNull(),
    threadId: text('thread_id').notNull().default(''),
    fromEmail: text('from_email').notNull(),
    toEmail: text('to_email').notNull().default(''),
    subject: text('subject').notNull(),
    snippet: text('snippet').notNull().default(''),
    body: text('body').notNull().default(''),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    isUnread: boolean('is_unread').notNull().default(true),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('mail_messages_user_ext_idx').on(table.userId, table.externalId),
  ]
);

export const tasks = pgTable(
  'tasks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    externalId: text('external_id').notNull(),
    listId: text('list_id').notNull().default('@default'),
    listTitle: text('list_title').notNull().default('My Tasks'),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    dueDate: text('due_date').notNull().default(''),
    status: text('status').notNull().default('needsAction'), // 'needsAction' | 'completed'
    priority: text('priority').notNull().default('medium'), // 'high' | 'medium' | 'low'
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tasks_user_ext_idx').on(table.userId, table.externalId),
  ]
);

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export const notes = pgTable('notes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  externalId: text('external_id').notNull().default(''),
  title: text('title').notNull().default(''),
  content: text('content').notNull().default(''),
  checklist: jsonb('checklist').$type<ChecklistItem[]>().notNull().default([]),
  color: text('color').notNull().default('slate'),
  isPinned: boolean('is_pinned').notNull().default(false),
  isShared: boolean('is_shared').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const chatSpaces = pgTable('chat_spaces', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  externalSpaceName: text('external_space_name').notNull().default(''),
  createdByUserId: integer('created_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  spaceId: integer('space_id')
    .references(() => chatSpaces.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  senderName: text('sender_name').notNull(),
  senderEmail: text('sender_email').notNull(),
  content: text('content').notNull(),
  externalMessageName: text('external_message_name').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const meetSessions = pgTable('meet_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  meetingUri: text('meeting_uri').notNull(),
  meetingCode: text('meeting_code').notNull().default(''),
  spaceName: text('space_name').notNull().default(''),
  status: text('status').notNull().default('active'), // 'active' | 'scheduled' | 'ended'
  scheduledFor: timestamp('scheduled_for'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const mapLocations = pgTable('map_locations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  placeId: text('place_id').notNull().default(''),
  name: text('name').notNull(),
  address: text('address').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  category: text('category').notNull().default('office'), // 'office' | 'client' | 'meeting' | 'logistics'
  notes: text('notes').notNull().default(''),
  isShared: boolean('is_shared').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  actorEmail: text('actor_email').notNull(),
  action: text('action').notNull(),
  service: text('service').notNull(),
  detail: text('detail').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const geminiThreads = pgTable('gemini_threads', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull().default('New Gemini Conversation'),
  model: text('model').notNull().default('gemini-4-hydrogen'),
  groundWithWorkspace: boolean('ground_with_workspace').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const geminiMessages = pgTable('gemini_messages', {
  id: serial('id').primaryKey(),
  threadId: integer('thread_id')
    .references(() => geminiThreads.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  role: text('role').notNull(), // 'user' | 'model'
  content: text('content').notNull(),
  contextRefs: jsonb('context_refs').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const classroomCourses = pgTable(
  'classroom_courses',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    section: text('section').notNull().default(''),
    descriptionHeading: text('description_heading').notNull().default(''),
    room: text('room').notNull().default(''),
    courseState: text('course_state').notNull().default('ACTIVE'),
    alternateLink: text('alternate_link').notNull().default(''),
    enrollmentCode: text('enrollment_code').notNull().default(''),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('classroom_courses_user_ext_idx').on(table.userId, table.externalId),
  ]
);

export interface ClassroomMaterialLink {
  title: string;
  url: string;
  type: string;
}

export const classroomItems = pgTable(
  'classroom_items',
  {
    id: serial('id').primaryKey(),
    courseId: integer('course_id')
      .references(() => classroomCourses.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    itemType: text('item_type').notNull(), // 'coursework' | 'announcement' | 'material'
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    state: text('state').notNull().default('PUBLISHED'),
    dueDate: text('due_date').notNull().default(''),
    alternateLink: text('alternate_link').notNull().default(''),
    materials: jsonb('materials').$type<ClassroomMaterialLink[]>().notNull().default([]),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('classroom_items_user_type_ext_idx').on(
      table.userId,
      table.itemType,
      table.externalId
    ),
  ]
);

export const contacts = pgTable(
  'contacts',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email').notNull().default(''),
    phone: text('phone').notNull().default(''),
    organization: text('organization').notNull().default(''),
    jobTitle: text('job_title').notNull().default(''),
    address: text('address').notNull().default(''),
    photoUrl: text('photo_url').notNull().default(''),
    source: text('source').notNull().default('contacts'), // 'contacts' | 'other' | 'directory' | 'manual'
    notes: text('notes').notNull().default(''),
    isShared: boolean('is_shared').notNull().default(false),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('contacts_user_ext_idx').on(table.userId, table.externalId),
  ]
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  workspaceRecords: many(workspaceRecords),
  calendarEvents: many(calendarEvents),
  mailMessages: many(mailMessages),
  tasks: many(tasks),
  notes: many(notes),
  chatMessages: many(chatMessages),
  meetSessions: many(meetSessions),
  mapLocations: many(mapLocations),
  auditLogs: many(auditLogs),
  geminiThreads: many(geminiThreads),
  classroomCourses: many(classroomCourses),
  contacts: many(contacts),
}));

export const workspaceRecordsRelations = relations(workspaceRecords, ({ one }) => ({
  owner: one(users, {
    fields: [workspaceRecords.userId],
    references: [users.id],
  }),
}));

export const chatSpacesRelations = relations(chatSpaces, ({ many }) => ({
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  space: one(chatSpaces, {
    fields: [chatMessages.spaceId],
    references: [chatSpaces.id],
  }),
  sender: one(users, {
    fields: [chatMessages.userId],
    references: [users.id],
  }),
}));

export const geminiThreadsRelations = relations(geminiThreads, ({ one, many }) => ({
  owner: one(users, {
    fields: [geminiThreads.userId],
    references: [users.id],
  }),
  messages: many(geminiMessages),
}));

export const geminiMessagesRelations = relations(geminiMessages, ({ one }) => ({
  thread: one(geminiThreads, {
    fields: [geminiMessages.threadId],
    references: [geminiThreads.id],
  }),
}));

export const classroomCoursesRelations = relations(classroomCourses, ({ one, many }) => ({
  owner: one(users, {
    fields: [classroomCourses.userId],
    references: [users.id],
  }),
  items: many(classroomItems),
}));

export const classroomItemsRelations = relations(classroomItems, ({ one }) => ({
  course: one(classroomCourses, {
    fields: [classroomItems.courseId],
    references: [classroomCourses.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  owner: one(users, {
    fields: [contacts.userId],
    references: [users.id],
  }),
}));
